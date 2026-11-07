import { redisConnection } from "../config/redis.js";

const MIN_DELAY_MS_DEFAULT = Math.max(0, Number(process.env.MIN_DELAY_BETWEEN_EMAILS_MS || 2000));
const NEXT_SEND_AT_KEY = "pulse:throttle:next-send-at-ms";
const SAFETY_HOLD_MS = 60_000; // crash recovery: if worker dies mid-send, gate reopens
const CONTENTION_BACKOFF_MAX_MS = 250; // bounded jitter on contention retries

/**
 * Effective post-send gap coordinated across ALL workers/batches via one Redis key.
 * Respects both the global configured minimum and the email's persisted batch delay:
 * - legacy/null batch delay => global minimum (env fallback)
 * - explicit 0 batch delay still respects a nonzero global minimum
 * - explicit nonzero batch delay is enforced even when global minimum is 0
 * Batches share the global throttle; they do not get independent parallel timelines.
 */
export function effectiveMinDelayMs(overrideMs?: number | null): number {
  const globalMin = MIN_DELAY_MS_DEFAULT;
  const batchMs =
    typeof overrideMs === "number" && Number.isFinite(overrideMs) && overrideMs >= 0
      ? Math.floor(overrideMs)
      : globalMin;
  return Math.max(globalMin, batchMs);
}

/**
 * Strict post-send gap across all workers (Redis-coordinated).
 * - Next send must not BEGIN until the effective delay after the previous send FINISHES.
 * - Atomic Lua: if not ready returns remaining hold; if ready sets a SAFETY_HOLD_MS crash-recoverable gate.
 * - Safety hold is preserved (crash protection). Contention retries are CAPPED to ~effective delay + bounded
 *   backoff so BullMQ jobs are not delayed for the entire safety-hold window (which previously stalled progress).
 * - Caller MUST call `completeMinSendDelay(email.sendDelayMs)` after an actual send attempt
 *   (success or terminal failure). On lock/claim failures or no-send paths, call
 *   `releaseMinSendDelayHold()` so other workers can proceed.
 * - Reservation receives the current email's effective delay so a nonzero batch delay is
 *   enforced even when MIN_DELAY_BETWEEN_EMAILS_MS is 0.
 */
const RESERVE_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local safety = tonumber(ARGV[2])
local nextAt = tonumber(redis.call('GET', key) or '0')
if now < nextAt then
  return {0, nextAt - now}
end
redis.call('SET', key, tostring(now + safety), 'PX', safety)
return {1, 0}
`;

function contentionBackoffMs(): number {
  return 50 + Math.floor(Math.random() * CONTENTION_BACKOFF_MAX_MS);
}

export async function reserveMinSendDelay(
  delayMsOverride?: number | null
): Promise<{ ok: true; effectiveDelayMs: number } | { ok: false; waitMs: number; effectiveDelayMs: number }> {
  const effectiveDelayMs = effectiveMinDelayMs(delayMsOverride);
  if (effectiveDelayMs <= 0) return { ok: true, effectiveDelayMs };
  const now = Date.now();
  const res = (await redisConnection.eval(RESERVE_LUA, 1, NEXT_SEND_AT_KEY, now, SAFETY_HOLD_MS)) as [number, number];
  if (res[0] === 1) return { ok: true, effectiveDelayMs };
  const remainingMs = Math.max(50, Number(res[1]));
  // Preserve safety hold in Redis, but cap BullMQ retry to effective delay + bounded backoff so workers
  // re-check near the real min-delay instead of waiting the full crash-hold window.
  const waitMs = Math.max(50, Math.min(remainingMs, effectiveDelayMs + contentionBackoffMs()));
  return { ok: false, waitMs, effectiveDelayMs };
}

/** Sets next-allowed-send to (now + effective delay). Call after each actual send attempt. */
export async function completeMinSendDelay(minDelayMsOverride?: number | null): Promise<void> {
  const minDelayMs = effectiveMinDelayMs(minDelayMsOverride);
  if (minDelayMs <= 0) {
    await redisConnection.del(NEXT_SEND_AT_KEY);
    return;
  }
  const nextAt = Date.now() + minDelayMs;
  await redisConnection.set(NEXT_SEND_AT_KEY, String(nextAt), "PX", minDelayMs + 5000);
}

/** Releases safety hold / throttle key when no send attempt happened (lock/claim failure). */
export async function releaseMinSendDelayHold(): Promise<void> {
  await redisConnection.del(NEXT_SEND_AT_KEY);
}

export function getMinDelayMsDefault(): number {
  return MIN_DELAY_MS_DEFAULT;
}

export function getMinDelayMs(): number {
  return MIN_DELAY_MS_DEFAULT;
}
