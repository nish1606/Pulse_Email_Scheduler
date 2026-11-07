import { Client } from "@elastic/elasticsearch";

export const EMAIL_INDEX = "pulse-emails";

export const esClient = new Client({
  node: process.env.ELASTICSEARCH_URL || "http://localhost:9200",
});

export async function ensureEmailIndex(): Promise<void> {
  const exists = await esClient.indices.exists({ index: EMAIL_INDEX });
  if (exists) return;
  await esClient.indices.create({
    index: EMAIL_INDEX,
    mappings: {
      properties: {
        id: { type: "keyword" },
        userId: { type: "keyword" },
        senderId: { type: "keyword" },
        senderEmail: { type: "keyword" },
        senderName: { type: "text", fields: { keyword: { type: "keyword", ignore_above: 256 } } },
        recipient: { type: "keyword" },
        subject: { type: "text", fields: { keyword: { type: "keyword", ignore_above: 256 } } },
        body: { type: "text" },
        status: { type: "keyword" },
        scheduledAt: { type: "date" },
        sentAt: { type: "date" },
        failureReason: { type: "text" },
        createdAt: { type: "date" },
        updatedAt: { type: "date" },
      },
    },
  });
}
