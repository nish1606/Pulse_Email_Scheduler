import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, SlidersHorizontal, RefreshCw, Clock, Star } from "lucide-react";
import { api } from "../services/api";
import type { EmailRow } from "../types";

function formatPill(iso: string) {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: "short" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
  return `${day} ${time}`;
}

export function ScheduledPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<EmailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = () => {
    setLoading(true);
    setError(null);
    api<{ emails: EmailRow[] }>("/api/emails/scheduled")
      .then((d) => setRows(d.emails || []))
      .catch((e) => setError(e?.message || "Failed to load scheduled emails"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => `${r.recipient} ${r.subject} ${r.body || ""}`.toLowerCase().includes(t));
  }, [rows, q]);

  return (
    <div className="flex h-full min-h-[calc(100vh-2rem)] flex-col bg-white">
      <div className="flex items-center gap-3 border-b border-ong-border px-4 py-4 md:px-8">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ong-muted" strokeWidth={1.75} aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            aria-label="Search scheduled emails"
            className="h-11 w-full rounded-full bg-ong-input pl-11 pr-4 text-[14px] text-ong-text placeholder:text-ong-muted outline-none focus:ring-2 focus:ring-ong-primary/15"
          />
        </div>
        <button type="button" className="flex h-10 w-10 items-center justify-center rounded-full text-ong-muted hover:bg-ong-input" aria-label="Filter">
          <SlidersHorizontal className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </button>
        <button type="button" onClick={load} className="flex h-10 w-10 items-center justify-center rounded-full text-ong-muted hover:bg-ong-input" aria-label="Refresh">
          <RefreshCw className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </button>
      </div>

      {loading ? (
        <div className="p-8 text-sm text-ong-muted">Loading scheduled emails...</div>
      ) : error ? (
        <div className="m-6 rounded-[12px] border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="p-10 text-center text-sm text-ong-muted">No scheduled emails found.</div>
      ) : (
        <ul className="flex-1 overflow-auto" aria-label="Scheduled emails">
          {filtered.map((r) => (
            <li key={r.id} className="border-b border-ong-border">
              <button type="button" onClick={() => navigate(`/email/${r.id}`)} className="flex min-h-[70px] w-full items-center gap-4 px-4 py-3 text-left hover:bg-ong-input/40 md:px-8">
                <div className="w-[140px] shrink-0 truncate text-[14px] text-ong-text md:w-[260px]">
                  <span className="text-ong-muted">To: </span>
                  <span className="font-medium text-ong-text">{r.recipient.split("@")[0] || r.recipient}</span>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-orange-300 bg-[#FFEDD5] px-2.5 py-1 text-[12px] font-medium text-[#C2410C]">
                  <Clock className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                  {formatPill(r.scheduledAt)}
                </span>
                <div className="min-w-0 flex-1 truncate text-[14px]">
                  <span className="font-medium text-ong-text">{r.subject}</span>
                  {r.body ? <span className="text-ong-muted"> - {r.body.replace(/\s+/g, " ").slice(0, 140)}</span> : null}
                </div>
                <Star className="h-[18px] w-[18px] shrink-0 text-ong-muted" strokeWidth={1.75} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
