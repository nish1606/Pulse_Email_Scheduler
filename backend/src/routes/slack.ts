import { Router, Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { HttpError } from "../utils/http.js";
import { disconnectSlackAccount, exchangeSlackCode, getSlackOAuthUrl, getSlackStatus, upsertSlackAccount } from "../services/slack.js";
import { redisConnection } from "../config/redis.js";
import { requireAuth } from "../middleware/auth.js";

export const slackRouter = Router();

function requireUserId(req: Request): string {
  const id = req.session?.userId;
  if (!id) throw new HttpError(401, "Authentication required");
  return id;
}

slackRouter.get("/status", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = requireUserId(req);
    const status = await getSlackStatus(userId);
    res.json({ userId, slack: status });
  } catch (err) {
    next(err);
  }
});

slackRouter.get("/connect", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = requireUserId(req);
    const state = crypto.randomBytes(16).toString("hex");
    await redisConnection.set(`pulse:slack:oauth:${state}`, userId, "EX", 10 * 60);
    const url = getSlackOAuthUrl(state);
    if (!url) {
      throw new HttpError(400, "Slack OAuth not configured. Set SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_REDIRECT_URI in backend/.env");
    }
    if (req.query.redirect === "1") return res.redirect(url);
    res.json({ url, userId });
  } catch (err) {
    next(err);
  }
});

slackRouter.get("/callback", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const errParam = typeof req.query.error === "string" ? req.query.error : "";
    if (errParam) throw new HttpError(400, `Slack authorization denied: ${errParam}`);
    if (!code || !state) throw new HttpError(400, "Missing Slack OAuth code/state");

    const key = `pulse:slack:oauth:${state}`;
    const userId = await redisConnection.get(key);
    await redisConnection.del(key);
    if (!userId) throw new HttpError(400, "Invalid or expired Slack OAuth state");

    const info = await exchangeSlackCode(code);
    await upsertSlackAccount(userId, info);

    const frontend = process.env.FRONTEND_URL || "http://localhost:5173";
    res.redirect(`${frontend}/?slack=connected`);
  } catch (err) {
    next(err);
  }
});

slackRouter.delete("/disconnect", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = requireUserId(req);
    const ok = await disconnectSlackAccount(userId);
    res.json({ disconnected: ok, userId });
  } catch (err) {
    next(err);
  }
});
