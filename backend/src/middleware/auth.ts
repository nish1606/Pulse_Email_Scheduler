import { Request, Response, NextFunction } from "express";
import { HttpError } from "../utils/http.js";

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (req.session?.userId) return next();
  return next(new HttpError(401, "Authentication required"));
}

export function getOptionalUserId(req: Request): string | null {
  return req.session?.userId ?? null;
}
