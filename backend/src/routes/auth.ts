import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma.js";
import { HttpError } from "../utils/http.js";
import { consumeGoogleState, createGoogleState, exchangeGoogleCode, getGoogleAuthUrl, isGoogleConfigured } from "../services/googleAuth.js";

export const authRouter = Router();

authRouter.get("/me", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.session?.userId;
    if (!userId) return res.json({ authenticated: false, user: null });
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, avatarUrl: true, googleId: true },
    });
    if (!user) {
      req.session.userId = undefined;
      return res.json({ authenticated: false, user: null });
    }
    res.json({ authenticated: true, user });
  } catch (err) {
    next(err);
  }
});

authRouter.get("/google", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isGoogleConfigured()) {
      throw new HttpError(400, "Google OAuth not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL in backend/.env");
    }
    const state = await createGoogleState();
    const url = getGoogleAuthUrl(state);
    if (!url) throw new HttpError(500, "Failed to create Google OAuth URL");
    if (req.query.redirect === "1") return res.redirect(url);
    res.json({ url });
  } catch (err) {
    next(err);
  }
});

authRouter.get("/google/callback", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const errParam = typeof req.query.error === "string" ? req.query.error : "";
    const frontend = process.env.FRONTEND_URL || "http://localhost:5173";
    if (errParam) return res.redirect(`${frontend}/login?error=${encodeURIComponent(errParam)}`);
    if (!code || !state) throw new HttpError(400, "Missing Google OAuth code/state");
    const ok = await consumeGoogleState(state);
    if (!ok) throw new HttpError(400, "Invalid or expired Google OAuth state");

    const profile = await exchangeGoogleCode(code);
    // Upsert by googleId; if an existing local/dev user has same email, attach google identity.
    let user = await prisma.user.findUnique({ where: { googleId: profile.googleId } });
    if (!user) {
      const byEmail = await prisma.user.findUnique({ where: { email: profile.email } });
      if (byEmail) {
        user = await prisma.user.update({
          where: { id: byEmail.id },
          data: { googleId: profile.googleId, name: profile.name ?? byEmail.name, avatarUrl: profile.avatarUrl ?? byEmail.avatarUrl },
        });
      } else {
        user = await prisma.user.create({
          data: { googleId: profile.googleId, email: profile.email, name: profile.name, avatarUrl: profile.avatarUrl },
        });
      }
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { email: profile.email, name: profile.name ?? user.name, avatarUrl: profile.avatarUrl ?? user.avatarUrl },
      });
    }

    req.session.userId = user.id;
    res.redirect(`${frontend}/?auth=success`);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", (req: Request, res: Response, next: NextFunction) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("pulse.sid");
    res.json({ ok: true });
  });
});
