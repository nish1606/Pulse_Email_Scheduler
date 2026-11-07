import { prisma } from "../config/prisma.js";
import { enqueueEmailJob } from "../queue/emailQueue.js";
import { EmailStatus } from "@prisma/client";

/**
 * Startup reconciliation: ensure every pending DB email has a BullMQ delayed job.
 * Uses a stable jobId (email:<id>) so duplicates are not created.
 */
export async function reconcilePendingEmailJobs(): Promise<{ enqueued: number; checked: number }> {
  const pending = await prisma.email.findMany({
    where: { status: { in: [EmailStatus.SCHEDULED, EmailStatus.RATE_LIMITED] } },
    select: { id: true, scheduledAt: true },
    orderBy: { scheduledAt: "asc" },
  });
  let enqueued = 0;
  for (const row of pending) {
    try {
      await enqueueEmailJob(row.id, row.scheduledAt);
      enqueued++;
    } catch (err: any) {
      // Job may already exist with same jobId; that's fine.
      if (!String(err?.message || "").includes("Job is already waiting")) {
        // ignore benign duplicates; log unexpected errors
        if (!String(err?.message || "").toLowerCase().includes("already exists")) {
          console.warn("[reconcile] could not enqueue", row.id, err?.message);
        }
      }
    }
  }
  if (pending.length) console.log(`[reconcile] checked=${pending.length} ensuredJobs=${enqueued}`);
  return { enqueued, checked: pending.length };
}
