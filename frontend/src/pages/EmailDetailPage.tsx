import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import type { EmailRow } from "../types";

export function EmailDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState<EmailRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) { setError("Missing email id"); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    setError(null);
    api<{ email: EmailRow }>(`/api/emails/${encodeURIComponent(id)}`)
      .then((d) => { if (alive) setEmail(d.email); })
      .catch((e) => { if (alive) setError(e?.message || "Failed to load email"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  if (loading) return <div className="p-8 text-sm text-ong-muted">Loading email...</div>;
  if (error || !email) return <div className="m-6 rounded-[12px] border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error || "Email not found"}</div>;

  const fromName = email.sender?.name || "Sender";
  const fromEmail = email.sender?.email || "";
  const dateStr = email.sentAt || email.scheduledAt;
  const date = dateStr ? new Date(dateStr).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

  return (
    <div className="min-h-full overflow-auto bg-white">
      <div className="mx-auto max-w-[1300px] px-4 py-8 md:px-10">
        <button type="button" onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-2 text-[14px] text-ong-muted hover:text-ong-text" aria-label="Back">
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} /> Back
        </button>
        <header className="flex flex-wrap items-start gap-4 border-b border-ong-border pb-6">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ong-primary text-[18px] font-semibold text-white" aria-hidden>
            {fromName.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-[16px] font-bold text-ong-text">{fromName}</span>
              {fromEmail ? <span className="text-[14px] text-ong-muted">&lt;{fromEmail}&gt;</span> : null}
            </div>
            <button type="button" className="mt-0.5 inline-flex items-center gap-1 text-[13px] text-ong-muted hover:text-ong-text" aria-label="Recipients">
              to {email.recipient} <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            </button>
            <div className="mt-1 text-[13px] font-medium text-ong-text">{email.subject}</div>
          </div>
          <time className="text-[13px] text-ong-muted">{date}</time>
        </header>

        <article className="max-w-[980px] py-8">
          <pre className="whitespace-pre-wrap break-words font-sans text-[16px] leading-[1.75] text-ong-text">{email.body || "(No body)"}</pre>
          {email.status ? <p className="mt-8 text-[12px] text-ong-muted">Status: {email.status}{email.failureReason ? ` — ${email.failureReason}` : ""}</p> : null}
        </article>
      </div>
    </div>
  );
}
