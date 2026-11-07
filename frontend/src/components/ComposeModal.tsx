import { useEffect, useState, type ChangeEvent } from "react";
import { api } from "../services/api";
import type { Sender } from "../types";
import { parseEmailFile } from "../utils/csv";

type Props = { open: boolean; onClose: () => void; senders: Sender[]; onScheduled: () => void; onSendersChanged?: () => void };

export function ComposeModal({ open, onClose, senders, onScheduled, onSendersChanged }: Props) {
  const [senderId, setSenderId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sendDelayMs, setSendDelayMs] = useState("");
  const [hourlyLimitInput, setHourlyLimitInput] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [scheduledAt, setScheduledAt] = useState(() => {
    const d = new Date(Date.now() + 60_000);
    d.setSeconds(0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [busy, setBusy] = useState(false);
  const [limitBusy, setLimitBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [limitError, setLimitError] = useState<string | null>(null);
  const [limitSuccess, setLimitSuccess] = useState<string | null>(null);

  const selectedSender = senders.find((s) => s.id === senderId) || null;

  useEffect(() => {
    if (!senderId) {
      setHourlyLimitInput("");
      return;
    }
    const s = senders.find((x) => x.id === senderId);
    setHourlyLimitInput(s?.hourlyLimit != null ? String(s.hourlyLimit) : "");
  }, [senderId, senders]);

  if (!open) return null;

  const resetFeedback = () => { setError(null); setSuccess(null); };
  const resetLimitFeedback = () => { setLimitError(null); setLimitSuccess(null); };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    resetFeedback();
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    const emails = await parseEmailFile(f);
    setRecipients(emails);
  };

  const saveHourlyLimit = async (restoreDefault = false) => {
    resetLimitFeedback();
    if (!senderId) {
      setLimitError("Select a sender first");
      return;
    }
    const raw = hourlyLimitInput.trim();
    let payload: { hourlyLimit: number | null };
    if (restoreDefault || raw === "") {
      payload = { hourlyLimit: null };
    } else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1) {
        setLimitError("Hourly limit must be a positive integer (or leave blank to use the environment default).");
        return;
      }
      payload = { hourlyLimit: n };
    }
    setLimitBusy(true);
    try {
      await api(`/api/senders/${encodeURIComponent(senderId)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setLimitSuccess(payload.hourlyLimit == null ? "Sender hourly limit restored to the environment default." : `Sender hourly limit saved (${payload.hourlyLimit}/hr).`);
      onSendersChanged?.();
    } catch (e: any) {
      setLimitError(e?.message || "Failed to save sender hourly limit");
    } finally {
      setLimitBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    resetFeedback();
    try {
      if (!senderId) throw new Error("Select a sender");
      if (!subject.trim()) throw new Error("Subject is required");
      if (!body.trim()) throw new Error("Body is required");
      if (!recipients.length) throw new Error("Upload a CSV/text file with at least one valid email address");
      if (sendDelayMs.trim() && (!Number.isInteger(Number(sendDelayMs)) || Number(sendDelayMs) < 0)) {
        throw new Error("Send delay must be an integer >= 0 ms (or leave blank for the default)");
      }
      const iso = new Date(scheduledAt).toISOString();
      const res = await api<{ count: number; duplicateCount: number }>("/api/emails/schedule", {
        method: "POST",
        body: JSON.stringify({
          senderId,
          subject,
          body,
          scheduledAt: iso,
          recipients,
          ...(sendDelayMs.trim() ? { sendDelayMs: Number(sendDelayMs) } : {}),
        }),
      });
      setSuccess(
        `Scheduled ${res.count} email(s) successfully.${res.duplicateCount ? ` ${res.duplicateCount} duplicate(s) detected.` : ""}${sendDelayMs.trim() ? ` Batch send delay: ${sendDelayMs} ms.` : ""}`
      );
      onScheduled();
    } catch (e: any) {
      setError(e?.message || "Failed to schedule emails");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[1px]" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-pulse-navy">Compose & Schedule</h2>
            <p className="mt-1 text-sm text-slate-600">Upload recipients and schedule delivery through the PULSE API.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Close</button>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="text-sm sm:col-span-2">
              <span className="pulse-label">Sender</span>
              <select value={senderId} onChange={(e) => { setSenderId(e.target.value); resetFeedback(); resetLimitFeedback(); }} className="pulse-input">
                <option value="">Select sender</option>
                {senders.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} &lt;{s.email}&gt;{s.hourlyLimit != null ? ` — ${s.hourlyLimit}/hr` : ""}</option>
                ))}
              </select>
            </label>

            <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="pulse-label mb-0">Sender hourly limit</span>
                <span className="text-xs text-slate-500">
                  {selectedSender
                    ? selectedSender.hourlyLimit != null
                      ? `Effective: ${selectedSender.hourlyLimit}/hr (custom)`
                      : "Effective: environment default (MAX_EMAILS_PER_HOUR_PER_SENDER)"
                    : "Select a sender to view/edit"}
                </span>
              </div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={hourlyLimitInput}
                  onChange={(e) => { setHourlyLimitInput(e.target.value); resetLimitFeedback(); }}
                  disabled={!selectedSender || limitBusy}
                  className="pulse-input sm:max-w-[220px]"
                  placeholder="Leave blank for env default"
                />
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={!selectedSender || limitBusy} onClick={() => void saveHourlyLimit(false)} className="pulse-btn-secondary">
                    {limitBusy ? "Saving..." : "Save limit"}
                  </button>
                  <button type="button" disabled={!selectedSender || limitBusy} onClick={() => void saveHourlyLimit(true)} className="pulse-btn-secondary">
                    Use default
                  </button>
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Persists on the selected sender via <code>PATCH /api/senders/:id</code>. This updates sender config only and does not schedule emails. The worker enforces the updated per-sender limit.
              </p>
              {limitError && <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{limitError}</div>}
              {limitSuccess && <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{limitSuccess}</div>}
            </div>

            <label className="text-sm sm:col-span-2">
              <span className="pulse-label">Subject</span>
              <input value={subject} onChange={(e) => { setSubject(e.target.value); resetFeedback(); }} className="pulse-input" placeholder="Email subject" />
            </label>

            <label className="text-sm sm:col-span-2">
              <span className="pulse-label">Body</span>
              <textarea value={body} onChange={(e) => { setBody(e.target.value); resetFeedback(); }} rows={6} className="pulse-input resize-y" placeholder="Write your message..." />
            </label>

            <label className="text-sm sm:col-span-2">
              <span className="pulse-label">Recipients (CSV or text file)</span>
              <input type="file" accept=".csv,.txt,text/plain,text/csv" onChange={onFile} className="block w-full rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-pulse-navy file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:opacity-95" />
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                {fileName && <span className="rounded-full bg-slate-100 px-2 py-1">{fileName}</span>}
                <span>Valid emails detected: <strong className="text-pulse-navy">{recipients.length}</strong></span>
              </div>
            </label>

            <label className="text-sm sm:col-span-2">
              <span className="pulse-label">Send delay between emails (ms, optional)</span>
              <input
                type="number"
                min={0}
                step={1}
                value={sendDelayMs}
                onChange={(e) => { setSendDelayMs(e.target.value); resetFeedback(); }}
                className="pulse-input"
                placeholder="Leave blank to use MIN_DELAY_BETWEEN_EMAILS_MS"
              />
              <p className="mt-1.5 text-xs text-slate-500">
                Batch-level setting persisted on each scheduled email. Blank/null uses the environment default; the worker preserves global throttling and multi-worker safety.
              </p>
            </label>

            <label className="text-sm sm:col-span-2">
              <span className="pulse-label">Start date & time (local)</span>
              <input type="datetime-local" value={scheduledAt} onChange={(e) => { setScheduledAt(e.target.value); resetFeedback(); }} className="pulse-input" />
              <p className="mt-1.5 text-xs text-slate-500">Times are sent to the API as ISO timestamps. Delivery pacing and per-sender hourly limits are enforced by the worker with Redis/DB safety checks.</p>
            </label>
          </div>

          {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{success}</div>}

          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className="pulse-btn-secondary">Cancel</button>
            <button type="button" disabled={busy} onClick={submit} className="pulse-btn-primary">
              {busy ? "Scheduling..." : "Schedule Emails"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
