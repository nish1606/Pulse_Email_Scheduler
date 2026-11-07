import { useEffect, useState } from "react";
import { api, apiGetSlackConnectUrl } from "../services/api";
import type { SlackStatus } from "../types";

type Props = { onNotice?: (msg: string | null) => void };

export function SlackConnectionCard({ onNotice }: Props) {
  const [status, setStatus] = useState<SlackStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ slack: SlackStatus }>("/api/slack/status");
      setStatus(data.slack);
    } catch (e: any) {
      setError(e?.message || "Failed to load Slack status");
      setStatus({ connected: false });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const url = await apiGetSlackConnectUrl();
      window.location.href = url;
    } catch (e: any) {
      setError(e?.message || "Failed to start Slack connection");
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!confirm("Disconnect Slack from this account? Rate-limit notifications will stop until reconnected.")) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/slack/disconnect", { method: "DELETE" });
      onNotice?.("Slack disconnected.");
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to disconnect Slack");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="pulse-card p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-pulse-navy">Slack integration</h2>
          <p className="mt-1 text-xs text-slate-500">
            Connect Slack to receive rate-limit notifications. Uses existing backend OAuth and disconnect endpoints.
          </p>
        </div>
        {!loading && (
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${status?.connected ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
            {status?.connected ? "Connected" : "Not connected"}
          </span>
        )}
      </div>

      {loading && <div className="mt-4 text-sm text-slate-600">Checking Slack status...</div>}
      {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {!loading && status?.connected && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-sm">
          <div className="grid gap-1 text-slate-700">
            <div><span className="font-medium text-slate-800">Workspace:</span> {status.teamName || "—"}</div>
            <div><span className="font-medium text-slate-800">Channel:</span> {status.channelName || status.channelId || "Default (SLACK_DEFAULT_CHANNEL_ID)"}</div>
            {status.connectedAt && <div><span className="font-medium text-slate-800">Connected:</span> {new Date(status.connectedAt).toLocaleString()}</div>}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void load()} className="pulse-btn-secondary">Refresh status</button>
            <button type="button" disabled={busy} onClick={() => void disconnect()} className="pulse-btn-secondary border-red-200 text-red-700 hover:bg-red-50">Disconnect</button>
          </div>
        </div>
      )}

      {!loading && !status?.connected && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void connect()} className="pulse-btn-primary">
            {busy ? "Redirecting..." : "Connect Slack"}
          </button>
          <button type="button" disabled={busy} onClick={() => void load()} className="pulse-btn-secondary">Refresh status</button>
        </div>
      )}
    </section>
  );
}
