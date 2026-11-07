export type User = {
  id: string;
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
  googleId?: string | null;
};

export type EmailRow = {
  id: string;
  senderId: string;
  sender?: { id: string; name: string; email: string };
  recipient: string;
  subject: string;
  body?: string;
  scheduledAt: string;
  sentAt?: string | null;
  status: string;
  failureReason?: string | null;
  etherealPreviewUrl?: string | null;
  sendDelayMs?: number | null;
};

export type Sender = {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  hourlyLimit?: number | null;
};

export type DashboardStats = {
  stats: {
    scheduled: number;
    processing: number;
    rateLimited: number;
    sent: number;
    failed: number;
    senders: number;
  };
  queue: { name: string; counts: Record<string, number> };
  limits: { maxEmailsPerHourPerSender: number };
};

export type SenderUsage = {
  senderId: string;
  name: string;
  email: string;
  used: number;
  limit: number;
  defaultLimit?: number;
  isCustomLimit?: boolean;
  remaining: number;
  bucketKey: string;
  nextWindowStart: string;
};

export type SlackStatus = {
  connected: boolean;
  teamName?: string | null;
  channelName?: string | null;
  channelId?: string | null;
  connectedAt?: string | null;
};
