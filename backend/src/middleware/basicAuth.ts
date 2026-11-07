import { Request, Response, NextFunction } from "express";

export function bullBoardBasicAuth(req: Request, res: Response, next: NextFunction) {
  const user = process.env.BULL_BOARD_USER;
  const pass = process.env.BULL_BOARD_PASS;
  if (!user || !pass) {
    return res.status(503).json({
      error: "Bull Board is not configured. Set BULL_BOARD_USER and BULL_BOARD_PASS in backend/.env",
    });
  }
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="PULSE Bull Board"');
    return res.status(401).send("Authentication required");
  }
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  const u = idx >= 0 ? decoded.slice(0, idx) : decoded;
  const p = idx >= 0 ? decoded.slice(idx + 1) : "";
  if (u !== user || p !== pass) {
    res.setHeader("WWW-Authenticate", 'Basic realm="PULSE Bull Board"');
    return res.status(401).send("Invalid credentials");
  }
  next();
}
