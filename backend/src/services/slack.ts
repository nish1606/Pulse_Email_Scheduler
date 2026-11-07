import { WebClient } from "@slack/web-api";
import { prisma } from "../config/prisma.js";
import { redisConnection } from "../config/redis.js";

const SCOPES = "chat:write,channels:read,groups:read,im:read,mpim:read";

export function getSlackOAuthUrl(state: string): string | null {
  const clientId = process.env.SLACK_CLIENT_ID;
  const redirectUri = process.env.SLACK_REDIRECT_URI;
  if (!clientId || !redirectUri) return null;
  const params = new URLSearchParams({
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: redirectUri,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

export async function exchangeSlackCode(code: string): Promise<{
  accessToken: string;
  teamId?: string;
  teamName?: string;
  botUserId?: string;
  authedUserId?: string;
}> {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const redirectUri = process.env.SLACK_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Slack OAuth is not configured (SLACK_CLIENT_ID/SECRET/REDIRECT_URI)");
  }
  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
  });
  const data = (await res.json()) as any;
  if (!data?.ok) throw new Error(`Slack OAuth failed: ${data?.error || "unknown_error"}`);
  return {
    accessToken: data.access_token,
    teamId: data.team?.id,
    teamName: data.team?.name,
    botUserId: data.bot_user_id,
    authedUserId: data.authed_user?.id,
  };
}

export async function upsertSlackAccount(userId: string, info: Awaited<ReturnType<typeof exchangeSlackCode>>): Promise<void> {
  // Pick a default channel: DM to installing user if possible is not resolved here; store bot token.
  // Channel can be set later; for now we post to a channel provided by user or fallback handled in send.
  await prisma.slackAccount.upsert({
    where: { userId },
    create: {
      userId,
      accessToken: info.accessToken,
      teamId: info.teamId ?? null,
      teamName: info.teamName ?? null,
      botUserId: info.botUserId ?? null,
    },
    update: {
      accessToken: info.accessToken,
      teamId: info.teamId ?? null,
      teamName: info.teamName ?? null,
      botUserId: info.botUserId ?? null,
    },
  });
}

export async function disconnectSlackAccount(userId: string): Promise<boolean> {
  try {
    await prisma.slackAccount.delete({ where: { userId } });
    return true;
  } catch {
    return false;
  }
}

export async function getSlackStatus(userId: string) {
  const acct = await prisma.slackAccount.findUnique({ where: { userId }, select: { teamName: true, channelName: true, channelId: true, connectedAt: true } });
  return acct ? { connected: true, ...acct } : { connected: false };
}

export async function sendSlackMessage(accessToken: string, text: string, channelId?: string | null): Promise<void> {
  const client = new WebClient(accessToken);
  // If no channel configured, try to open DM with auth.test bot context is unreliable; require channelId in config later.
  // For M5 step 1 we accept channelId from env fallback.
  const channel = channelId || process.env.SLACK_DEFAULT_CHANNEL_ID || undefined;
  if (!channel) throw new Error("No Slack channel configured (set channel on account or SLACK_DEFAULT_CHANNEL_ID)");
  await client.chat.postMessage({ channel, text });
}

/**
 * Notify on rate limit with Redis dedup (per sender + UTC hour bucket) to avoid repeated identical alerts.
 */
export async function notifyRateLimitOnce(senderId: string, bucketKey: string, text: string): Promise<boolean> {
  const dedupKey = `pulse:slack:ratelimit-notified:${senderId}:${bucketKey}`;
  const set = await redisConnection.set(dedupKey, "1", "PX", 2 * 60 * 60 * 1000, "NX");
  if (set !== "OK") return false; // already notified

  // Resolve Slack account for the sender's owning user only. Avoid global fallbacks that could
  // route notifications to an unrelated workspace.
  const sender = await prisma.sender.findUnique({ where: { id: senderId }, select: { userId: true, name: true, email: true } });
  if (!sender?.userId) return false;
  const acct = await prisma.slackAccount.findUnique({ where: { userId: sender.userId } });
  if (!acct) return false; // disconnected/not configured - no crash

  try {
    await sendSlackMessage(acct.accessToken, text, acct.channelId);
    return true;
  } catch (err: any) {
    console.error("[slack] notify failed (non-fatal)", err?.message || err);
    return false;
  }
}
