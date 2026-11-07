import { redisConnection } from "../config/redis.js";

const MAX_PER_HOUR_DEFAULT = Math.max(1, Number(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER || 100));

function hourBucketStartUtc(ms: number): number {
  const d = new Date(ms);
  d.setUTCMinutes(0, 0, 0);
  return d.getTime();
}

function hourKey(senderId: string, bucketStartMs: number): string {
  const bucket = new Date(bucketStartMs).toISOString().slice(0, 13).replace(/[-T]/g, ""); // YYYYMMDDHH
  return `pulse:rate:sender:${senderId}:${bucket}`;
}

function reservationKey(emailId: string, bucketStartMs: number): string {
  const bucket = new Date(bucketStartMs).toISOString().slice(0, 13).replace(/[-T]/g, "");
  return `pulse:rate:email:${emailId}:${bucket}`;
}

/**
 * Atomic, per-email idempotent hourly quota reservation (Redis Lua). Fixed UTC hour window.
 * - If this email already has a reservation in the current bucket: allowed (no double-count).
 * - Else if under limit: INCR counter + create email reservation; allowed.
 * - Else (at/over limit): not allowed, no increment; retry at next UTC hour.
 * Retries/re-entries/min-delay reschedules for the same email never consume extra quota.
 */
const RESERVE_LUA = `
local ckey = KEYS[1]
local rkey = KEYS[2]
local limit = tonumber(ARGV[1])
local expireMs = tonumber(ARGV[2])
local rexpireMs = tonumber(ARGV[3])
if redis.call('EXISTS', rkey) == 1 then
  local count = tonumber(redis.call('GET', ckey) or '0')
  return {1, count, 1}
end
local count = tonumber(redis.call('GET', ckey) or '0')
if count >= limit then
  return {0, count, 0}
end
count = redis.call('INCR', ckey)
if count == 1 then
  redis.call('PEXPIRE', ckey, expireMs)
end
redis.call('SET', rkey, '1', 'PX', rexpireMs)
return {1, count, 0}
`;

export function getUtcHourBucketKey(date = new Date()): string {
  return date.toISOString().slice(0, 13).replace(/[-T]/g, ""); // YYYYMMDDHH
}

export type RateLimitResult =
  | { allowed: true; count: number; alreadyReserved: boolean; bucketKey: string }
  | { allowed: false; count: number; retryAtMs: number; bucketKey: string };

export function getEffectiveHourlyLimit(senderHourlyLimit?: number | null): number {
  if (typeof senderHourlyLimit === "number" && Number.isFinite(senderHourlyLimit) && senderHourlyLimit >= 1) {
    return Math.floor(senderHourlyLimit);
  }
  return MAX_PER_HOUR_DEFAULT;
}

export async function reserveHourlyQuotaForEmail(
  senderId: string,
  emailId: string,
  senderHourlyLimit?: number | null
): Promise<RateLimitResult> {
  const limit = getEffectiveHourlyLimit(senderHourlyLimit);
  const now = Date.now();
  const bucketStart = hourBucketStartUtc(now);
  const bucketKey = getUtcHourBucketKey(new Date(now));
  const nextBucketStart = bucketStart + 60 * 60 * 1000;
  const ckey = hourKey(senderId, bucketStart);
  const rkey = reservationKey(emailId, bucketStart);
  const expireMs = nextBucketStart - now + 60_000;
  const rexpireMs = nextBucketStart - now + 120_000;

  const res = (await redisConnection.eval(RESERVE_LUA, 2, ckey, rkey, limit, expireMs, rexpireMs)) as [number, number, number];
  if (res[0] === 1) return { allowed: true, count: Number(res[1]), alreadyReserved: Number(res[2]) === 1, bucketKey };
  return { allowed: false, count: Number(res[1]), retryAtMs: nextBucketStart + 1000, bucketKey };
}

export function getCurrentSenderHourlyUsage(senderId: string, senderHourlyLimit?: number | null, now = Date.now()) {
  const bucketStart = hourBucketStartUtc(now);
  const bucketKey = getUtcHourBucketKey(new Date(now));
  const nextBucketStart = bucketStart + 60 * 60 * 1000;
  const ckey = hourKey(senderId, bucketStart);
  return { bucketStart, bucketKey, nextBucketStart, ckey, limit: getEffectiveHourlyLimit(senderHourlyLimit) };
}

export function getMaxEmailsPerHourDefault(): number {
  return MAX_PER_HOUR_DEFAULT;
}

// Backward-compatible export name used in existing code paths.
export function getMaxEmailsPerHour(): number {
  return MAX_PER_HOUR_DEFAULT;
}

