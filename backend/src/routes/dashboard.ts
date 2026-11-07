import { Router, Request, Response, NextFunction } from "express";
import { EmailStatus } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { emailQueue } from "../queue/emailQueue.js";
import { redisConnection } from "../config/redis.js";
import { getMaxEmailsPerHour, getEffectiveHourlyLimit, getUtcHourBucketKey } from "../queue/rateLimit.js";

export const dashboardRouter = Router();

dashboardRouter.get("/stats", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.session.userId!;
    const [scheduledCount, processingCount, rateLimitedCount, sentCount, failedCount, senderCount, queueCounts] =
      await Promise.all([
        prisma.email.count({ where: { userId, status: EmailStatus.SCHEDULED } }),
        prisma.email.count({ where: { userId, status: EmailStatus.PROCESSING } }),
        prisma.email.count({ where: { userId, status: EmailStatus.RATE_LIMITED } }),
        prisma.email.count({ where: { userId, status: EmailStatus.SENT } }),
        prisma.email.count({ where: { userId, status: EmailStatus.FAILED } }),
        prisma.sender.count({ where: { isActive: true, userId } }),
        emailQueue.getJobCounts("waiting", "delayed", "active", "completed", "failed"),
      ]);

    res.json({
      stats: {
        scheduled: scheduledCount,
        processing: processingCount,
        rateLimited: rateLimitedCount,
        sent: sentCount,
        failed: failedCount,
        senders: senderCount,
      },
      queue: { name: "email-send", counts: queueCounts },
      limits: { maxEmailsPerHourPerSender: getMaxEmailsPerHour() },
    });
  } catch (err) {
    next(err);
  }
});

dashboardRouter.get("/senders/usage", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.session.userId!;
    const defaultLimit = getMaxEmailsPerHour();
    const bucketKey = getUtcHourBucketKey();
    const now = new Date();
    const bucketStart = new Date(now);
    bucketStart.setUTCMinutes(0, 0, 0);
    const nextWindowStart = new Date(bucketStart.getTime() + 60 * 60 * 1000);

    const senders = await prisma.sender.findMany({
      where: { isActive: true, userId },
      select: { id: true, name: true, email: true, hourlyLimit: true },
      orderBy: { createdAt: "asc" },
    });
    const keys = senders.map((s) => `pulse:rate:sender:${s.id}:${bucketKey}`);
    const values = keys.length ? await redisConnection.mget(...keys) : [];
    const usage = senders.map((s, i) => {
      const limit = getEffectiveHourlyLimit(s.hourlyLimit);
      const used = Math.max(0, Number(values[i] || 0));
      return {
        senderId: s.id,
        name: s.name,
        email: s.email,
        used,
        limit,
        defaultLimit,
        isCustomLimit: typeof s.hourlyLimit === "number",
        remaining: Math.max(0, limit - used),
        bucketKey,
        nextWindowStart: nextWindowStart.toISOString(),
      };
    });
    res.json({ usage, defaultLimit, bucketKey, nextWindowStart: nextWindowStart.toISOString() });
  } catch (err) {
    next(err);
  }
});
