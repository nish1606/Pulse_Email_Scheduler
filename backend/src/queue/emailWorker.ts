import "dotenv/config";
import { Worker, Job, DelayedError } from "bullmq";
import { EmailStatus } from "@prisma/client";
import { redisConnection } from "../config/redis.js";
import { prisma } from "../config/prisma.js";
import { sendMail } from "../services/mail.js";
import { indexEmailById } from "../services/search.js";
import { EMAIL_QUEUE_NAME, type EmailJobData } from "./emailQueue.js";
import { reserveMinSendDelay, completeMinSendDelay, releaseMinSendDelayHold, getMinDelayMs } from "./sendThrottle.js";
import { reserveHourlyQuotaForEmail, getMaxEmailsPerHour, getEffectiveHourlyLimit } from "./rateLimit.js";
import { acquireEmailSendLock, releaseEmailSendLock } from "./sendLock.js";
import { notifyRateLimitOnce } from "../services/slack.js";

const concurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY || 5));

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function processEmailJob(job: Job<EmailJobData>, token?: string): Promise<void> {
  const { emailId } = job.data;
  const email = await prisma.email.findUnique({
    where: { id: emailId },
    include: { sender: true },
  });
  if (!email) return;

  // Idempotency/protection: only one worker should process a scheduled row.
  if (email.status === EmailStatus.SENT) return;
  if (email.status !== EmailStatus.SCHEDULED && email.status !== EmailStatus.RATE_LIMITED && email.status !== EmailStatus.PROCESSING) {
    return;
  }

  const effectiveHourlyLimit = getEffectiveHourlyLimit(email.sender.hourlyLimit);

  // Per-sender hourly quota (Redis atomic, per-email idempotent reservation).
  // Quota is checked before the global min-delay gate so min-delay reschedules never consume quota.
  // A reservation is tied to (emailId,bucket); retries/re-entries do not double-count.
  const quota = await reserveHourlyQuotaForEmail(email.senderId, email.id, email.sender.hourlyLimit);
  if (!quota.allowed) {
    await prisma.email.update({
      where: { id: email.id, status: { in: [EmailStatus.SCHEDULED, EmailStatus.RATE_LIMITED, EmailStatus.PROCESSING] } },
      data: { status: EmailStatus.RATE_LIMITED, failureReason: "Hourly sender limit reached; rescheduled to next hour." },
    });
    // Slack notification (real integration): fire once per sender+hour bucket; never crash worker if disconnected.
    const retryAtIso = new Date(quota.retryAtMs).toISOString();
    notifyRateLimitOnce(
      email.senderId,
      quota.bucketKey,
      `PULSE rate limit: sender ${email.sender.name} <${email.sender.email}> reached ${effectiveHourlyLimit}/hr (UTC bucket ${quota.bucketKey}). Next send window starts ~${retryAtIso}.`
    ).catch((e) => console.error("[slack] notify error (non-fatal)", e?.message || e));
    void indexEmailById(email.id);
    await job.moveToDelayed(quota.retryAtMs, token);
    throw new DelayedError();
  }

  // Strict post-send gap across all workers/batches (one Redis throttle key).
  // Effective delay = max(global MIN_DELAY_BETWEEN_EMAILS_MS, persisted Email.sendDelayMs or global fallback).
  // Legacy sendDelayMs=null uses env fallback; zero batch still respects nonzero global minimum.
  // Reserve receives the current email's effective delay so nonzero batch delays are enforced even when global default is 0.
  const slot = await reserveMinSendDelay(email.sendDelayMs);
  if (process.env.THROTTLE_DIAGNOSTICS === "1") {
    console.log(`[throttle] workerPid=${process.pid} jobId=${String(job.id)} emailId=${email.id} reserved=${slot.ok} waitMs=${"waitMs" in slot ? slot.waitMs : 0} effectiveDelayMs=${slot.effectiveDelayMs}`);
  }
  if (!slot.ok) {
    await job.moveToDelayed(Date.now() + slot.waitMs, token);
    throw new DelayedError();
  }

  // Per-email Redis lock + DB claim: prevents concurrent duplicate sends across workers/processes.
  const locked = await acquireEmailSendLock(email.id);
  if (!locked) {
    await releaseMinSendDelayHold();
    return; // another worker holds this email; avoid double-send
  }

  let attemptedSend = false;
  try {
    const fresh = await prisma.email.findUnique({ where: { id: email.id }, select: { status: true } });
    if (!fresh || fresh.status === EmailStatus.SENT) return;
    if (fresh.status === EmailStatus.FAILED) return;

    const claimed = await prisma.email.updateMany({
      where: { id: email.id, status: { in: [EmailStatus.SCHEDULED, EmailStatus.RATE_LIMITED] } },
      data: { status: EmailStatus.PROCESSING, bullJobId: String(job.id) },
    });
    if (claimed.count !== 1) {
      // Holding the per-email lock but could not claim - avoid completing the job while DB is non-terminal.
      await prisma.email.updateMany({
        where: { id: email.id, status: { in: [EmailStatus.SCHEDULED, EmailStatus.RATE_LIMITED] } },
        data: { status: EmailStatus.SCHEDULED },
      });
      await job.moveToDelayed(Date.now() + 5000, token);
      throw new DelayedError();
    }

    attemptedSend = true;
    const result = await sendMail({
      from: `${email.sender.name} <${email.sender.email}>`,
      to: email.recipient,
      subject: email.subject,
      text: email.body,
      html: `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(email.body)}</pre>`,
    });
    await prisma.email.update({
      where: { id: email.id },
      data: {
        status: EmailStatus.SENT,
        sentAt: new Date(),
        etherealPreviewUrl: result.previewUrl,
        failureReason: null,
      },
    });
    void indexEmailById(email.id); // non-fatal; must not affect delivery outcome
  } catch (err: any) {
    if (err instanceof DelayedError) throw err;
    const message = err?.message ? String(err.message).slice(0, 1000) : "Send failed";
    const attempts = job.opts.attempts ?? 1;
    const isFinal = job.attemptsMade + 1 >= attempts;
    await prisma.email.update({
      where: { id: email.id },
      data: {
        status: isFinal ? EmailStatus.FAILED : EmailStatus.SCHEDULED,
        failureReason: message,
      },
    });
    if (isFinal) void indexEmailById(email.id);
    throw err;
  } finally {
    await releaseEmailSendLock(email.id).catch(() => {});
    // Strict post-send gap after an actual send attempt; release hold if we never sent.
    if (attemptedSend) await completeMinSendDelay(email.sendDelayMs).catch(() => {});
    else await releaseMinSendDelayHold().catch(() => {});
  }
}

export const emailWorker = new Worker<EmailJobData>(EMAIL_QUEUE_NAME, processEmailJob, {
  connection: redisConnection,
  concurrency,
});

emailWorker.on("completed", (job) => {
  console.log(`[worker] completed ${job.id}`);
});
emailWorker.on("failed", (job, err) => {
  console.error(`[worker] failed ${job?.id}`, err?.message);
});

console.log(
  `[worker] PULSE email worker started (concurrency=${concurrency}, minDelayMs=${getMinDelayMs()} [default], maxPerHourDefault=${getMaxEmailsPerHour()})`
);

const shutdown = async (signal: string) => {
  console.log(`[worker] shutting down (${signal})`);
  await emailWorker.close();
  await redisConnection.quit();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
