export function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-pulse-navy">{title}</h1>
      <p className="mt-2 text-sm text-slate-600">{note}</p>
    </div>
  );
}
