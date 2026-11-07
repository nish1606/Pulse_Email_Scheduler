import crypto from "node:crypto";
import { redisConnection } from "../config/redis.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_CALLBACK_URL || "http://localhost:3000/api/auth/google/callback";
  return { clientId, clientSecret, redirectUri };
}

export function isGoogleConfigured(): boolean {
  const { clientId, clientSecret } = googleConfig();
  return !!(clientId && clientSecret);
}

export async function createGoogleState(): Promise<string> {
  const state = crypto.randomBytes(16).toString("hex");
  await redisConnection.set(`pulse:google:oauth:${state}`, "1", "EX", 10 * 60);
  return state;
}

export async function consumeGoogleState(state: string): Promise<boolean> {
  const key = `pulse:google:oauth:${state}`;
  const val = await redisConnection.get(key);
  if (!val) return false;
  await redisConnection.del(key);
  return true;
}

export function getGoogleAuthUrl(state: string): string | null {
  const { clientId, redirectUri } = googleConfig();
  if (!clientId) return null;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeGoogleCode(code: string): Promise<{ googleId: string; email: string; name?: string; avatarUrl?: string }> {
  const { clientId, clientSecret, redirectUri } = googleConfig();
  if (!clientId || !clientSecret) throw new Error("Google OAuth not configured");
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const tokenData = (await tokenRes.json()) as any;
  if (!tokenRes.ok || !tokenData?.access_token) {
    throw new Error(`Google token exchange failed: ${tokenData?.error_description || tokenData?.error || "unknown"}`);
  }
  const userRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const user = (await userRes.json()) as any;
  if (!userRes.ok || !user?.sub || !user?.email) {
    throw new Error("Google userinfo failed");
  }
  return {
    googleId: String(user.sub),
    email: String(user.email).toLowerCase(),
    name: user.name ? String(user.name) : undefined,
    avatarUrl: user.picture ? String(user.picture) : undefined,
  };
}
