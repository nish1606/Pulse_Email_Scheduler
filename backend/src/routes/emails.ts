import { Router, Request, Response, NextFunction } from "express";
import { createHash } from "node:crypto";
import { EmailStatus, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { enqueueEmailJob } from "../queue/emailQueue.js";
import { HttpError, parseDate, parseEmail, requireBodyObject, isNonEmptyString } from "../utils/http.js";
import { indexEmailById, searchEmails } from "../services/search.js";
import { requireAuth } from "../middleware/auth.js";

export const emailsRouter = Router();

function uid(req: Request): string {
  const id = req.session?.userId;
  if (!id) throw new HttpError(401, "Authentication required");
  return id;
}

function buildIdempotencyKey(senderId: string, recipient: string, subject: string, body: string, scheduledAt: Date): string {
  const base = `${senderId}|${recipient}|${subject}|${body}|${scheduledAt.toISOString()}`;
  return createHash("sha256").update(base).digest("hex");
}

function parseSendDelayMs(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new HttpError(400, "sendDelayMs must be an integer >= 0, or null to use the environment default");
  }
  return n;
}

function envDefaultSendDelayMs(): number | null {
  const raw = process.env.MIN_DELAY_BETWEEN_EMAILS_MS;
  if (raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function serializeEmail(e: any) {
  return {
    id: e.id,
    senderId: e.senderId,
    sender: e.sender ? { id: e.sender.id, name: e.sender.name, email: e.sender.email } : undefined,
    recipient: e.recipient,
    subject: e.subject,
    body: e.body,
    scheduledAt: e.scheduledAt,
    sentAt: e.sentAt,
    status: e.status,
    failureReason: e.failureReason,
    etherealPreviewUrl: e.etherealPreviewUrl,
    idempotencyKey: e.idempotencyKey,
    sendDelayMs: e.sendDelayMs ?? null,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

// POST /api/emails/schedule
emailsRouter.post("/schedule", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const body = requireBodyObject(req.body);
    const senderId = isNonEmptyString(body.senderId) ? body.senderId.trim() : null;
    const subject = isNonEmptyString(body.subject) ? body.subject.trim() : null;
    const emailBody = isNonEmptyString(body.body) ? body.body : null;
    const scheduledAt = parseDate(body.scheduledAt);
    const sendDelayMs = parseSendDelayMs(body.sendDelayMs);

    const recipientsInput = body.recipients ?? (body.recipient ? [body.recipient] : null);
    if (!senderId) throw new HttpError(400, "senderId is required");
    if (!subject) throw new HttpError(400, "subject is required");
    if (!emailBody) throw new HttpError(400, "body is required");
    if (!scheduledAt) throw new HttpError(400, "scheduledAt must be a valid date/time");
    if (!Array.isArray(recipientsInput) || recipientsInput.length === 0) {
      throw new HttpError(400, "recipients must be a non-empty array (or provide recipient)");
    }

    const recipients = Array.from(
      new Set(
        recipientsInput
          .map((r) => parseEmail(r))
          .filter((r): r is string => !!r)
      )
    );
    if (recipients.length === 0) throw new HttpError(400, "No valid recipient email addresses provided");

    const sender = await prisma.sender.findUnique({ where: { id: senderId } });
    if (!sender || !sender.isActive || sender.userId !== userId) throw new HttpError(404, "Active sender not found");

    // Configurable per batch, persisted per email. Null/omitted => env fallback resolved at creation
    // for explicit persistence; worker still falls back for legacy rows.
    const persistedSendDelayMs = sendDelayMs === undefined ? envDefaultSendDelayMs() : sendDelayMs;

    const clientIdempotency = isNonEmptyString(body.idempotencyKey) ? body.idempotencyKey.trim() : null;
    const created: any[] = [];
    const duplicates: any[] = [];

    for (const recipient of recipients) {
      const idempotencyKey =
        clientIdempotency && recipients.length === 1
          ? clientIdempotency
          : buildIdempotencyKey(senderId, recipient, subject, emailBody, scheduledAt);
      try {
        const row = await prisma.email.create({
          data: {
            userId,
            senderId,
            recipient,
            subject,
            body: emailBody,
            scheduledAt,
            status: EmailStatus.SCHEDULED,
            idempotencyKey,
            sendDelayMs: persistedSendDelayMs,
          },
          include: { sender: true },
        });
        created.push(serializeEmail(row));
      } catch (err: any) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          const existing = await prisma.email.findUnique({ where: { idempotencyKey }, include: { sender: true } });
          if (existing && existing.userId === userId) {
            duplicates.push(serializeEmail(existing));
            continue;
          }
          // Do not expose another user's record for a colliding idempotency key.
          throw new HttpError(409, "Scheduling conflict: duplicate idempotency key");
        }
        throw err;
      }
    }

    // Milestone 3: all scheduled emails go through BullMQ (delayed jobs). Worker processes them.
    // Due-now jobs use delay ~0. Redis/DB persistence preserves jobs across restarts; reconcile on startup.
    for (const row of created) {
      try {
        const jobId = await enqueueEmailJob(row.id, new Date(row.scheduledAt));
        await prisma.email.update({ where: { id: row.id }, data: { bullJobId: jobId } }).catch(() => {});
      } catch (err: any) {
        console.error("[schedule] failed to enqueue", row.id, err?.message);
      }
    }
    // Index after DB+enqueue succeed; ES failure must not affect primary flow.
    await Promise.all(created.map((c) => indexEmailById(c.id).catch(() => {})));
    const refreshed = await prisma.email.findMany({
      where: { id: { in: created.map((c) => c.id) } },
      include: { sender: true },
    });
    const refreshedById = new Map(refreshed.map((r) => [r.id, serializeEmail(r)]));

    res.status(201).json({
      scheduled: created.map((c) => refreshedById.get(c.id) ?? c),
      duplicates,
      count: created.length,
      duplicateCount: duplicates.length,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/emails/scheduled
emailsRouter.get("/scheduled", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const emails = await prisma.email.findMany({
      where: { userId, status: { in: [EmailStatus.SCHEDULED, EmailStatus.PROCESSING, EmailStatus.RATE_LIMITED] } },
      include: { sender: true },
      orderBy: { scheduledAt: "asc" },
      take: 200,
    });
    res.json({ emails: emails.map(serializeEmail) });
  } catch (err) {
    next(err);
  }
});

// GET /api/emails/sent
emailsRouter.get("/sent", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const emails = await prisma.email.findMany({
      where: { userId, status: { in: [EmailStatus.SENT, EmailStatus.FAILED] } },
      include: { sender: true },
      orderBy: [{ sentAt: "desc" }, { updatedAt: "desc" }],
      take: 200,
    });
    res.json({ emails: emails.map(serializeEmail) });
  } catch (err) {
    next(err);
  }
});

// GET /api/emails/search?q=
emailsRouter.get("/search", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const result = await searchEmails(q, 50, userId);
    res.json(result);
  } catch (err: any) {
    console.warn("[search] query failed (non-fatal)", err?.message || err);
    res.json({ emails: [], total: 0, warning: "Search temporarily unavailable" });
  }
});

// GET /api/emails/:id
emailsRouter.get("/:id", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const id = String(req.params.id || "");
    if (!id) throw new HttpError(400, "id is required");
    const email = await prisma.email.findFirst({ where: { id, userId }, include: { sender: true } });
    if (!email) throw new HttpError(404, "Email not found");
    res.json({ email: serializeEmail(email) });
  } catch (err) {
    next(err);
  }
});
