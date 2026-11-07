import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma.js";
import { HttpError, parseEmail, isNonEmptyString, requireBodyObject } from "../utils/http.js";
import { requireAuth } from "../middleware/auth.js";

export const sendersRouter = Router();

function uid(req: Request): string {
  const id = req.session?.userId;
  if (!id) throw new HttpError(401, "Authentication required");
  return id;
}

function parseHourlyLimit(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw new HttpError(400, "hourlyLimit must be an integer >= 1, or null to use the environment default");
  }
  return n;
}

const senderSelect = {
  id: true,
  name: true,
  email: true,
  isActive: true,
  hourlyLimit: true,
  createdAt: true,
} as const;

sendersRouter.get("/", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const senders = await prisma.sender.findMany({
      where: { isActive: true, userId },
      orderBy: { createdAt: "desc" },
      select: senderSelect,
    });
    res.json({ senders });
  } catch (err) {
    next(err);
  }
});

sendersRouter.post("/", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const body = requireBodyObject(req.body);
    const name = isNonEmptyString(body.name) ? body.name.trim() : null;
    const email = parseEmail(body.email);
    const hourlyLimit = parseHourlyLimit(body.hourlyLimit);
    if (!name) throw new HttpError(400, "name is required");
    if (!email) throw new HttpError(400, "A valid sender email is required");

    const sender = await prisma.sender.create({
      data: { name, email, userId, ...(hourlyLimit !== undefined ? { hourlyLimit } : {}) },
      select: senderSelect,
    });
    res.status(201).json({ sender });
  } catch (err: any) {
    if (err?.code === "P2002") return next(new HttpError(409, "Sender email already exists"));
    next(err);
  }
});

sendersRouter.patch("/:id", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const id = String(req.params.id || "");
    if (!id) throw new HttpError(400, "id is required");
    const body = requireBodyObject(req.body);
    const existing = await prisma.sender.findFirst({ where: { id, userId, isActive: true } });
    if (!existing) throw new HttpError(404, "Sender not found");

    const data: { name?: string; hourlyLimit?: number | null } = {};
    if (body.name !== undefined) {
      if (!isNonEmptyString(body.name)) throw new HttpError(400, "name must be a non-empty string");
      data.name = body.name.trim();
    }
    const hourlyLimit = parseHourlyLimit(body.hourlyLimit);
    if (hourlyLimit !== undefined) data.hourlyLimit = hourlyLimit;
    if (Object.keys(data).length === 0) throw new HttpError(400, "No valid fields to update");

    const sender = await prisma.sender.update({ where: { id }, data, select: senderSelect });
    res.json({ sender });
  } catch (err) {
    next(err);
  }
});
