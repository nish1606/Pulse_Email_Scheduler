import { Queue } from "bullmq";
import { redisConnection } from "../config/redis.js";

export const EMAIL_QUEUE_NAME = "email-send";

export type EmailJobData = {
  emailId: string;
};

export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

export async function enqueueEmailJob(emailId: string, scheduledAt: Date): Promise<string> {
  const delay = Math.max(0, scheduledAt.getTime() - Date.now());
  const jobId = `email-${emailId}`; // stable ID prevents duplicate BullMQ jobs for the same DB row
  const job = await emailQueue.add(
    "send-email",
    { emailId },
    {
      jobId,
      delay,
    }
  );
  return String(job.id);
}
