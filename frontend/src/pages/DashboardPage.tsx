import { useEffect, useState } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { api } from "../services/api";
import type { DashboardStats, Sender, SenderUsage } from "../types";
import { SlackConnectionCard } from "../components/SlackConnectionCard";

type LayoutCtx = { reloadCounts?: () => void };

export function DashboardPage() {
  const navigate = useNavigate();
  const ctx = useOutletContext<LayoutCtx>();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [usage, setUsage] = useState<SenderUsage[]>([]);
  const [defaultLimit, setDefaultLimit] = useState<number | null>(null);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get("slack") === "connected") {
      setNotice("Slack connected successfully.");
      const next = new URLSearchParams(searchParams);
      next.delete("slack");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, u, send] = await Promise.all([
        api<DashboardStats>("/api/dashboard/stats"),
        api<{ usage: SenderUsage[]; defaultLimit?: number }>("/api/dashboard/senders/usage"),
        api<{ senders: Sender[] }>("/api/senders"),
      ]);
      setStats(s);
      setUsage(u.usage || []);
      setDefaultLimit(typeof u.defaultLimit === "number" ? u.defaultLimit : s.limits.maxEmailsPerHourPerSender);
      setSenders(send.senders || []);
      ctx.reloadCounts?.();
    } catch (e: any) {
      setError(e?.message || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  const qc = stats?.queue?.counts || {};

  return (
    <div className="mx-auto max-w-[1300px] space-y-6 bg-white px-4 py-6 md:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[30px] font-normal tracking-tight text-ong-text">Dashboard</h1>
          <p className="mt-1 text-sm text-ong-muted">Queue status, sender usage, and activity.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => navigate("/compose")} className="ong-btn-pill-outline">Compose</button>
          <button type="button" onClick={() => void load()} className="ong-btn-pill-outline !border-ong-border !text-ong-text hover:!bg-ong-input">Refresh</button>
        </div>
      </div>

      {loading && <div className="ong-card p-5 text-sm text-ong-muted">Loading dashboard data...</div>}
      {error && <div className="rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</div>}
      {notice && <div className="rounded-[12px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</div>}

      <SlackConnectionCard onNotice={setNotice} />

      {stats && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Stat label="Scheduled" value={stats.stats.scheduled} />
            <Stat label="Processing" value={stats.stats.processing} />
            <Stat label="Rate limited" value={stats.stats.rateLimited} />
            <Stat label="Sent" value={stats.stats.sent} />
            <Stat label="Failed" value={stats.stats.failed} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="ong-card p-5 md:p-6">
              <h2 className="text-[16px] font-semibold text-ong-text">Queue status (BullMQ)</h2>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 xl:grid-cols-5">
                {(["waiting", "delayed", "active", "completed", "failed"] as const).map((k) => (
                  <div key={k} className="rounded-[12px] bg-ong-input p-3">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-ong-muted">{k}</div>
                    <div className="mt-1 text-[20px] font-semibold text-ong-text">{Number(qc[k] ?? 0)}</div>
                  </div>
                ))}
              </div>
            </section>
            <section className="ong-card p-5 md:p-6">
              <h2 className="text-[16px] font-semibold text-ong-text">Sender hourly usage</h2>
              <p className="mt-1 text-xs text-ong-muted">Default: {defaultLimit ?? stats.limits.maxEmailsPerHourPerSender}/hr (env). Redis UTC-hour counters.</p>
              <div className="mt-4 space-y-3">
                {usage.length === 0 ? (
                  <div className="rounded-[12px] border border-dashed border-ong-border p-4 text-sm text-ong-muted">No senders for this account. ({senders.length} loaded)</div>
                ) : usage.map((u) => {
                  const pct = u.limit > 0 ? Math.min(100, (u.used / u.limit) * 100) : 0;
                  return (
                    <div key={u.senderId} className="rounded-[12px] border border-ong-border p-3.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-ong-text">{u.name}</div>
                          <div className="truncate text-xs text-ong-muted">{u.email}</div>
                        </div>
                        <div className="text-right text-sm text-ong-text">{u.used}/{u.limit} <span className="text-ong-muted">({u.remaining} left)</span></div>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-ong-input">
                        <div className="h-full rounded-full bg-ong-primary" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="ong-card p-4">
      <div className="text-sm font-medium text-ong-muted">{label}</div>
      <div className="mt-2 text-[24px] font-semibold tracking-tight text-ong-text">{value}</div>
    </div>
  );
}


