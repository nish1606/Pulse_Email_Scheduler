import "dotenv/config";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import session from "express-session";
import { RedisStore } from "connect-redis";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { authRouter } from "./routes/auth.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { emailsRouter } from "./routes/emails.js";
import { sendersRouter } from "./routes/senders.js";
import { slackRouter } from "./routes/slack.js";
import { HttpError } from "./utils/http.js";
import { reconcilePendingEmailJobs } from "./queue/reconcile.js";
import { emailQueue } from "./queue/emailQueue.js";
import { redisConnection } from "./config/redis.js";
import { bullBoardBasicAuth } from "./middleware/basicAuth.js";
import { requireAuth } from "./middleware/auth.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);

// Production safety: refuse weak/missing session secrets; local dev keeps existing behavior.
const sessionSecret = process.env.SESSION_SECRET || "dev_insecure_change_me";
const weakSessionSecrets = new Set(["dev_insecure_change_me", "change_me_in_local_dev"]);
if (process.env.NODE_ENV === "production" && weakSessionSecrets.has(sessionSecret)) {
  console.error(
    "[config] Refusing to start in production: SESSION_SECRET is missing or set to a known default. Set a strong random SESSION_SECRET."
  );
  process.exit(1);
}

// connect-redis v10 expects a node-redis (v4+) client API; the app uses ioredis.
// Minimal adapter for session storage only (queue/scheduling keep using redisConnection directly).
const sessionRedisClient = {
  get: (key: string) => redisConnection.get(key),
  set: (key: string, val: string, opts?: { expiration?: { type?: string; value?: number } }) => {
    const ex = opts?.expiration;
    if (ex?.type === "EX" && typeof ex.value === "number") return redisConnection.set(key, val, "EX", ex.value);
    return redisConnection.set(key, val);
  },
  expire: (key: string, seconds: number) => redisConnection.expire(key, seconds),
  del: (keys: string[] | string) => (Array.isArray(keys) ? redisConnection.del(...keys) : redisConnection.del(keys)),
  mGet: (keys: string[]) => redisConnection.mget(...keys),
  async *scanIterator(opts: { MATCH: string; COUNT?: number }) {
    let cursor = "0";
    const count = opts.COUNT ?? 100;
    do {
      const [next, keys] = await redisConnection.scan(cursor, "MATCH", opts.MATCH, "COUNT", count);
      cursor = next;
      if (keys.length) yield keys;
    } while (cursor !== "0");
  },
};

// Parse JSON bodies (needed for future POST APIs)
app.use(express.json({ limit: "1mb" }));
// Allow frontend dev server to call the API
app.use(
  cors({
    origin: process.env.FRONTEND_URL ?? "http://localhost:5173",
    credentials: true,
  })
);

if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
app.use(
  session({
    name: "pulse.sid",
    store: new RedisStore({ client: sessionRedisClient as any, prefix: "pulse:sess:" }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "PULSE backend",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/auth", authRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/senders", sendersRouter);
app.use("/api/emails", emailsRouter);
app.use("/api/slack", slackRouter);

app.get("/api/queue/stats", requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Expose global queue counts only in non-production; avoid leaking operational system-wide state
    // to ordinary authenticated users in production. Bull Board remains protected separately.
    if (process.env.NODE_ENV === "production" && process.env.EXPOSE_QUEUE_STATS !== "true") {
      throw new HttpError(404, "Not found");
    }
    const counts = await emailQueue.getJobCounts("waiting", "delayed", "active", "completed", "failed");
    res.json({ queue: "email-send", counts });
  } catch (err) {
    next(err);
  }
});

const bullBoardPath = "/admin/queues";
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath(bullBoardPath);
createBullBoard({ queues: [new BullMQAdapter(emailQueue)], serverAdapter });
app.use(bullBoardPath, bullBoardBasicAuth, serverAdapter.getRouter());

// Central error handler (keep responses consistent)
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  console.error(err);
  return res.status(500).json({ error: "Internal server error" });
});

app.listen(port, () => {
  console.log(`PULSE API listening on http://localhost:${port}`);
  // Non-fatal: ensures pending DB emails have BullMQ jobs after restarts.
  reconcilePendingEmailJobs().catch((err) => console.error("[reconcile] startup error", err));
});
