import "dotenv/config";
import { Redis } from "ioredis";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

export const redisConnection = new Redis(redisUrl, {
  maxRetriesPerRequest: null, // required by BullMQ
});

redisConnection.on("error", (err: Error) => {
  console.error("[redis] connection error", err.message);
});
