import { esClient, EMAIL_INDEX, ensureEmailIndex } from "../config/elasticsearch.js";
import { prisma } from "../config/prisma.js";

let ensured = false;
async function ensure(): Promise<boolean> {
  if (ensured) return true;
  try {
    await ensureEmailIndex();
    ensured = true;
    return true;
  } catch (err: any) {
    console.warn("[search] ensure index failed (non-fatal)", err?.message || err);
    return false;
  }
}

export async function indexEmailById(emailId: string): Promise<void> {
  try {
    if (!(await ensure())) return;
    const e = await prisma.email.findUnique({ where: { id: emailId }, include: { sender: true } });
    if (!e) return;
    await esClient.index({
      index: EMAIL_INDEX,
      id: e.id,
      document: {
        id: e.id,
        userId: e.userId ?? null,
        senderId: e.senderId,
        senderEmail: e.sender?.email ?? null,
        senderName: e.sender?.name ?? null,
        recipient: e.recipient,
        subject: e.subject,
        body: e.body,
        status: e.status,
        scheduledAt: e.scheduledAt,
        sentAt: e.sentAt,
        failureReason: e.failureReason,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      },
      refresh: false,
    });
  } catch (err: any) {
    console.warn("[search] index failed (non-fatal)", emailId, err?.message || err);
  }
}

export async function searchEmails(q: string, limit = 50, userId?: string) {
  const query = (q || "").trim();
  if (!query) return { emails: [], total: 0 };
  await ensure().catch(() => {});
  const statusMatch = query.toUpperCase();
  const statusValues = ["SCHEDULED", "PROCESSING", "SENT", "FAILED", "RATE_LIMITED"];
  const statusFilter = statusValues.includes(statusMatch) ? { term: { status: statusMatch } } : null;
  const userFilter = userId ? { term: { userId } } : null;
  const res = await esClient.search({
    index: EMAIL_INDEX,
    size: Math.min(Math.max(1, limit), 200),
    query: {
      bool: {
        filter: userFilter ? [userFilter] : [],
        must: [
          {
            bool: {
              should: [
                { wildcard: { recipient: { value: `*${query.toLowerCase()}*`, case_insensitive: true } } },
                { match: { subject: { query, operator: "and" } } },
                ...(statusFilter ? [statusFilter] : []),
              ],
              minimum_should_match: 1,
            },
          },
        ],
      },
    },
    sort: [{ updatedAt: { order: "desc", unmapped_type: "date" } }],
  });
  const hits = (res.hits?.hits || []) as Array<{ _source?: any }>;
  return {
    emails: hits.map((h) => h._source).filter(Boolean),
    total: typeof res.hits?.total === "number" ? res.hits.total : res.hits?.total?.value ?? hits.length,
  };
}
