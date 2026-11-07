import { redisConnection } from "../config/redis.js";

const LOCK_TTL_MS = 5 * 60 * 1000; // covers SMTP + DB update; crash recovery via expiry
const key = (emailId: string) => `pulse:send-lock:email:${emailId}`;

/** Acquire per-email send lock (multi-worker idempotency). */
export async function acquireEmailSendLock(emailId: string): Promise<boolean> {
  const res = await redisConnection.set(key(emailId), "1", "PX", LOCK_TTL_MS, "NX");
  return res === "OK";
}

export async function releaseEmailSendLock(emailId: string): Promise<void> {
  await redisConnection.del(key(emailId));
}
