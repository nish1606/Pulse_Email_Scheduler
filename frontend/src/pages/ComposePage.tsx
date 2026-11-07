import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import {
  ArrowLeft, Paperclip, Clock, ChevronDown, Calendar, Upload,
  Undo2, Redo2, Bold, Italic, Underline, AlignLeft, AlignCenter, List, ListOrdered,
  IndentIncrease, IndentDecrease, Quote, Strikethrough, Type,
} from "lucide-react";
import { api } from "../services/api";
import { parseEmailFile } from "../utils/csv";
import type { Sender } from "../types";

type LayoutCtx = { reloadCounts?: () => void; senders?: Sender[] };

function parseEmails(raw: string): string[] {
  const re = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of raw.match(re) || []) {
    const e = m.toLowerCase();
    if (!seen.has(e)) { seen.add(e); out.push(e); }
  }
  return out;
}

function localInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ComposePage() {
  const navigate = useNavigate();
  const ctx = useOutletContext<LayoutCtx>();
  const [senders, setSenders] = useState<Sender[]>(ctx.senders || []);
  const [senderId, setSenderId] = useState("");
  const [toInput, setToInput] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [delaySec, setDelaySec] = useState("");
  const [hourlyLimit, setHourlyLimit] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [sendLaterAt, setSendLaterAt] = useState<string | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [pickValue, setPickValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ctx.senders?.length) { setSenders(ctx.senders); if (!senderId) setSenderId(ctx.senders[0].id); return; }
    api<{ senders: Sender[] }>("/api/senders").then((d) => {
      setSenders(d.senders || []);
      if (!senderId && d.senders?.[0]) setSenderId(d.senders[0].id);
    }).catch(() => {});
  }, [ctx.senders]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setPopoverOpen(false);
    };
    if (popoverOpen) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [popoverOpen]);

  const selectedSender = senders.find((s) => s.id === senderId);
  const allRecipients = useMemo(() => {
    const typed = parseEmails(toInput);
    const seen = new Set(recipients.map((r) => r.toLowerCase()));
    const merged = [...recipients];
    for (const t of typed) if (!seen.has(t)) { seen.add(t); merged.push(t); }
    return merged;
  }, [recipients, toInput]);
  const visibleChips = allRecipients.slice(0, 3);
  const overflow = Math.max(0, allRecipients.length - 3);

  const applyQuick = (label: string) => {
    const base = new Date();
    base.setDate(base.getDate() + 1);
    if (label === "Tomorrow") base.setHours(9, 0, 0, 0);
    if (label.includes("10:00")) base.setHours(10, 0, 0, 0);
    if (label.includes("11:00")) base.setHours(11, 0, 0, 0);
    if (label.includes("3:00")) base.setHours(15, 0, 0, 0);
    setPickValue(localInputValue(base));
  };

  const confirmSendLater = () => {
    if (pickValue) setSendLaterAt(pickValue);
    setPopoverOpen(false);
  };

  const onUploadList = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const emails = await parseEmailFile(f);
    setRecipients((prev) => {
      const seen = new Set(prev.map((x) => x.toLowerCase()));
      const next = [...prev];
      for (const em of emails) if (!seen.has(em)) { seen.add(em); next.push(em); }
      return next;
    });
    setToInput("");
    e.target.value = "";
  };

  const onAttach = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length) setAttachments((prev) => [...prev, ...files]);
    e.target.value = "";
  };

  const removeRecipient = (email: string) => setRecipients((p) => p.filter((x) => x !== email));
  const removeAttachment = (idx: number) => setAttachments((p) => p.filter((_, i) => i !== idx));

  const submit = async () => {
    setBusy(true); setError(null); setSuccess(null);
    try {
      const finalRecipients = allRecipients.length ? allRecipients : parseEmails(toInput);
      if (!senderId) throw new Error("Select a sender");
      if (!subject.trim()) throw new Error("Subject is required");
      if (!body.trim()) throw new Error("Body is required");
      if (!finalRecipients.length) throw new Error("Add at least one recipient (To field or Upload List)");
      const when = sendLaterAt ? new Date(sendLaterAt) : new Date(Date.now() + 60_000);
      const iso = when.toISOString();
      const res = await api<{ count: number; duplicateCount: number }>("/api/emails/schedule", {
        method: "POST",
        body: JSON.stringify({
          senderId, subject, body, scheduledAt: iso, recipients: finalRecipients,
          ...(delaySec.trim() ? { sendDelayMs: Math.round(Number(delaySec) * 1000) } : {}),
        }),
      });
      setSuccess(`Scheduled ${res.count} email(s)${res.duplicateCount ? ` (${res.duplicateCount} duplicate(s))` : ""}.${attachments.length ? " (Attachments shown for layout; file upload not wired to backend.)" : ""}`);
      ctx.reloadCounts?.();
      setTimeout(() => navigate("/scheduled"), 900);
    } catch (e: any) {
      setError(e?.message || "Failed to schedule");
    } finally {
      setBusy(false);
    }
  };

  const headerLabel = sendLaterAt ? "Send Later" : "Send";

  return (
    <div className="min-h-full bg-white">
      <div className="sticky top-0 z-10 border-b border-ong-border bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1300px] items-center justify-between gap-4 px-4 py-3 md:px-8">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => navigate(-1)} className="rounded-full p-2 text-ong-text hover:bg-ong-input" aria-label="Back">
              <ArrowLeft className="h-5 w-5" strokeWidth={1.75} />
            </button>
            <h1 className="text-[30px] font-normal tracking-tight text-ong-text">Compose New Email</h1>
          </div>
          <div className="relative flex items-center gap-2" ref={popoverRef}>
            <button type="button" onClick={() => attachInputRef.current?.click()} className={`relative rounded-full p-2 hover:bg-ong-input ${attachments.length ? "text-ong-primary" : "text-ong-muted"}`} aria-label="Attach files">
              <Paperclip className="h-5 w-5" strokeWidth={1.75} />
              {attachments.length > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-ong-primary px-1 text-[10px] font-semibold text-white">{attachments.length}</span>}
            </button>
            <input ref={attachInputRef} type="file" multiple accept="image/*,.pdf,.png,.jpg,.jpeg" className="hidden" onChange={onAttach} />
            <button type="button" onClick={() => setPopoverOpen((v) => !v)} className={`rounded-full p-2 hover:bg-ong-input ${sendLaterAt ? "text-ong-primary" : "text-ong-muted"}`} aria-label="Send later" aria-expanded={popoverOpen}>
              <Clock className="h-5 w-5" strokeWidth={1.75} />
            </button>
            <button type="button" onClick={submit} disabled={busy} className="ong-btn-pill-outline">{busy ? "Scheduling..." : headerLabel}</button>

            {popoverOpen && (
              <div className="absolute right-0 top-full z-20 mt-2 w-[400px] max-w-[calc(100vw-2rem)] rounded-[12px] border border-ong-border bg-white p-5 shadow-[0_12px_40px_rgba(0,0,0,0.12)]">
                <div className="text-[15px] font-medium text-ong-text">Send Later</div>
                <div className="relative mt-3 border-b border-ong-border">
                  <input
                    type="datetime-local"
                    value={pickValue}
                    onChange={(e) => setPickValue(e.target.value)}
                    placeholder="Pick date & time"
                    aria-label="Pick date and time"
                    className="w-full bg-transparent py-2 pr-8 text-[14px] text-ong-text placeholder:text-ong-muted outline-none"
                  />
                  <Calendar className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-ong-muted" strokeWidth={1.75} aria-hidden />
                </div>
                <ul className="mt-2">
                  {["Tomorrow", "Tomorrow, 10:00 AM", "Tomorrow, 11:00 AM", "Tomorrow, 3:00 PM"].map((opt) => (
                    <li key={opt}>
                      <button type="button" onClick={() => applyQuick(opt)} className="w-full rounded-[8px] px-1 py-2.5 text-left text-[14px] text-ong-text hover:bg-ong-input">{opt}</button>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex items-center justify-end gap-4">
                  <button type="button" onClick={() => setPopoverOpen(false)} className="text-[14px] font-medium text-ong-text">Cancel</button>
                  <button type="button" onClick={confirmSendLater} className="ong-btn-pill-outline !py-1.5">Done</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1300px] px-4 py-6 md:px-8">
        {error && <div className="mb-4 rounded-[12px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {success && <div className="mb-4 rounded-[12px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{success}</div>}

        <div className="space-y-0">
          <FormRow label="From">
            <div className="relative inline-block">
              <select
                value={senderId}
                onChange={(e) => setSenderId(e.target.value)}
                aria-label="From sender"
                className="appearance-none rounded-[10px] bg-ong-input py-2 pl-3 pr-9 text-[14px] text-ong-text outline-none focus:ring-2 focus:ring-ong-primary/15"
              >
                <option value="">Select sender</option>
                {senders.map((s) => <option key={s.id} value={s.id}>{s.email || s.name}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ong-muted" aria-hidden />
            </div>
            {selectedSender?.name ? <span className="ml-2 text-[13px] text-ong-muted">{selectedSender.name}</span> : null}
          </FormRow>

          <FormRow label="To">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 border-b border-ong-border py-2">
              {visibleChips.map((em) => (
                <span key={em} className="inline-flex items-center gap-1 rounded-full border border-ong-primary bg-ong-tint px-2.5 py-1 text-[13px] text-ong-primary">
                  {em}
                  <button type="button" onClick={() => removeRecipient(em)} className="text-ong-primary/70 hover:text-ong-primary" aria-label={`Remove ${em}`}>×</button>
                </span>
              ))}
              {overflow > 0 && <span className="inline-flex rounded-full border border-ong-primary bg-ong-tint px-2.5 py-1 text-[13px] text-ong-primary">+{overflow}</span>}
              <input
                value={toInput}
                onChange={(e) => setToInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    const found = parseEmails(toInput);
                    if (found.length) { setRecipients((p) => { const s = new Set(p.map((x)=>x.toLowerCase())); return [...p, ...found.filter(f=>!s.has(f))]; }); setToInput(""); }
                  }
                }}
                placeholder={allRecipients.length ? "" : "recipient@example.com"}
                aria-label="To recipients"
                className="min-w-[180px] flex-1 bg-transparent text-[14px] text-ong-text placeholder:text-ong-muted outline-none"
              />
            </div>
            <button type="button" onClick={() => fileInputRef.current?.click()} className="ml-3 inline-flex shrink-0 items-center gap-1.5 text-[14px] font-medium text-ong-primary hover:underline">
              <Upload className="h-4 w-4" strokeWidth={1.75} aria-hidden /> Upload List
            </button>
            <input ref={fileInputRef} type="file" accept=".csv,.txt,text/plain,text/csv" className="hidden" onChange={onUploadList} />
          </FormRow>

          <FormRow label="Subject">
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" aria-label="Subject" className="flex-1 border-b border-ong-border bg-transparent py-2.5 text-[14px] text-ong-text placeholder:text-ong-muted outline-none" />
          </FormRow>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-ong-border py-4 pl-[88px]">
            <label className="flex items-center gap-3 text-[14px] text-ong-text">
              <span>Delay between 2 emails</span>
              <input value={delaySec} onChange={(e) => setDelaySec(e.target.value)} placeholder="00" inputMode="numeric" aria-label="Delay between 2 emails (seconds)" className="h-10 w-[85px] rounded-[10px] border border-ong-border bg-white px-3 text-center text-[14px] outline-none focus:ring-2 focus:ring-ong-primary/15" />
            </label>
            <label className="flex items-center gap-3 text-[14px] text-ong-text">
              <span>Hourly Limit</span>
              <input value={hourlyLimit} onChange={(e) => setHourlyLimit(e.target.value)} placeholder="00" inputMode="numeric" aria-label="Hourly limit" className="h-10 w-[85px] rounded-[10px] border border-ong-border bg-white px-3 text-center text-[14px] outline-none focus:ring-2 focus:ring-ong-primary/15" />
            </label>
            <span className="text-[12px] text-ong-muted">(Delay maps to schedule `sendDelayMs` in seconds×1000; hourly limit is sender config — save via backend if needed.)</span>
          </div>

          <div className="mt-4">
            <div className="rounded-[12px] bg-ong-input p-3">
              <div className="mb-2 inline-flex flex-wrap items-center gap-0.5 rounded-full bg-white px-2 py-1 shadow-sm" aria-label="Formatting toolbar">
                <ToolBtn label="Undo"><Undo2 className="h-4 w-4" strokeWidth={1.75} /></ToolBtn>
                <ToolBtn label="Redo"><Redo2 className="h-4 w-4" strokeWidth={1.75} /></ToolBtn>
                <Sep />
                <span className="inline-flex items-center gap-0.5 px-1.5 text-[13px] text-ong-text"><Type className="h-4 w-4" strokeWidth={1.75} /><ChevronDown className="h-3 w-3 text-ong-muted" /></span>
                <Sep />
                <ToolBtn label="Bold"><Bold className="h-4 w-4" strokeWidth={1.75} /></ToolBtn>
                <ToolBtn label="Italic"><Italic className="h-4 w-4" strokeWidth={1.75} /></ToolBtn>
                <ToolBtn label="Underline"><Underline className="h-4 w-4" strokeWidth={1.75} /></ToolBtn>
                <Sep />
                <ToolBtn label="Align left"><AlignLeft className="h-4 w-4" strokeWidth={1.75} /></ToolBtn>
                <ToolBtn label="Align center"><AlignCenter className="h-4 w-4" strokeWidth={1.75} /></ToolBtn>
                <Sep />
                <ToolBtn label="Numbered list"><ListOrdered className="h-4 w-4" strokeWidth={1.75} /></ToolBtn>
                <ToolBtn label="Bulleted list"><List className="h-4 w-4" strokeWidth={1.75} /></ToolBtn>
                <Sep />
                <ToolBtn label="Increase indent"><IndentIncrease className="h-4 w-4" strokeWidth={1.75} /></ToolBtn>
                <ToolBtn label="Decrease indent"><IndentDecrease className="h-4 w-4" strokeWidth={1.75} /></ToolBtn>
                <Sep />
                <ToolBtn label="Quote"><Quote className="h-4 w-4" strokeWidth={1.75} /></ToolBtn>
                <ToolBtn label="Strikethrough"><Strikethrough className="h-4 w-4" strokeWidth={1.75} /></ToolBtn>
              </div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Type Your Reply..."
                aria-label="Email body"
                rows={12}
                className="w-full resize-y bg-transparent px-1 py-2 text-[15px] text-ong-text placeholder:text-ong-muted outline-none"
              />
            </div>

            {attachments.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-4">
                {attachments.map((f, i) => {
                  const url = f.type.startsWith("image/") ? URL.createObjectURL(f) : null;
                  const size = f.size < 1024 * 1024 ? `${(f.size / 1024).toFixed(0)} KB` : `${(f.size / (1024 * 1024)).toFixed(1)} MB`;
                  return (
                    <div key={`${f.name}-${i}`} className="w-[260px] overflow-hidden rounded-[12px] bg-ong-input">
                      {url ? <img src={url} alt="" className="h-[145px] w-full object-cover" /> : <div className="flex h-[145px] items-center justify-center text-ong-muted"><Paperclip className="h-8 w-8" strokeWidth={1.5} /></div>}
                      <div className="flex items-start justify-between gap-2 p-3">
                        <div className="min-w-0">
                          <div className="truncate text-[14px] font-medium text-ong-text" title={f.name}>{f.name}</div>
                          <div className="text-[12px] text-ong-muted">{size}</div>
                        </div>
                        <button type="button" onClick={() => removeAttachment(i)} className="text-[12px] text-ong-muted hover:text-ong-text" aria-label={`Remove ${f.name}`}>Remove</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-ong-border py-3">
      <div className="w-[80px] shrink-0 text-[14px] text-ong-muted">{label}</div>
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
    </div>
  );
}

function ToolBtn({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <button type="button" className="rounded p-1.5 text-ong-text/80 hover:bg-ong-input" aria-label={label} title={label}>
      {children}
    </button>
  );
}

function Sep() {
  return <span className="mx-1 h-4 w-px bg-ong-border" aria-hidden />;
}
