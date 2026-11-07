import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Clock, Send, ChevronDown, LayoutDashboard, LogOut } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { api } from "../services/api";
import type { DashboardStats, Sender } from "../types";

export function DashboardLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [counts, setCounts] = useState({ scheduled: 0, sent: 0 });
  const [senders, setSenders] = useState<Sender[]>([]);

  const load = async (forUserId: string) => {
    try {
      const [s, send] = await Promise.all([
        api<DashboardStats>("/api/dashboard/stats"),
        api<{ senders: Sender[] }>("/api/senders"),
      ]);
      // Ignore stale responses after user switch/logout.
      if (forUserId !== user?.id) return;
      setCounts({ scheduled: s.stats.scheduled, sent: s.stats.sent });
      setSenders(send.senders || []);
    } catch {
      /* keep prior; pages handle auth/errors */
    }
  };
  useEffect(() => {
    setCounts({ scheduled: 0, sent: 0 });
    setSenders([]);
    setAccountOpen(false);
    setNavOpen(false);
    if (user?.id) void load(user.id);
  }, [user?.id]);

  const onLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const itemClass = (active: boolean) =>
    `flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-[14px] transition ${
      active ? "bg-ong-tint font-semibold text-ong-text" : "text-ong-text/80 hover:bg-ong-input"
    }`;

  const SidebarInner = ({ onPick }: { onPick?: () => void }) => (
    <>
      <div className="px-5 pt-6">
        <div className="text-[28px] font-extrabold tracking-[0.08em] text-ong-text" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>PULSE</div>
      </div>
      <div className="relative px-4 pt-5">
        <button
          type="button"
          onClick={() => setAccountOpen((v) => !v)}
          className="flex w-full items-center gap-3 rounded-[14px] bg-ong-input px-3 py-3 text-left"
          aria-label="Account"
          aria-expanded={accountOpen}
        >
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ong-primary text-sm font-semibold text-white">
              {(user?.name || user?.email || "U").slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-medium text-ong-text">{user?.name || "User"}</div>
            <div className="truncate text-[12px] text-ong-muted">{user?.email || ""}</div>
          </div>
          <ChevronDown className={`h-4 w-4 shrink-0 text-ong-muted transition ${accountOpen ? "rotate-180" : ""}`} aria-hidden />
        </button>
        {accountOpen && (
          <div className="mt-2 rounded-[12px] border border-ong-border bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => { setAccountOpen(false); void onLogout(); }}
              className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left text-[13px] text-ong-text hover:bg-ong-input"
            >
              <LogOut className="h-4 w-4 text-ong-muted" aria-hidden />
              Log out
            </button>
          </div>
        )}
      </div>
      <div className="px-4 pt-4">
        <button type="button" onClick={() => { navigate("/compose"); onPick?.(); }} className="ong-btn-pill-outline w-full">
          Compose
        </button>
      </div>
      <div className="px-5 pt-6 text-[11px] font-semibold tracking-[0.12em] text-ong-muted">CORE</div>
      <nav className="space-y-1 px-3 pt-2" aria-label="Primary">
        <NavLink to="/scheduled" className={({ isActive }) => itemClass(isActive)} onClick={onPick}>
          <Clock className="h-[18px] w-[18px] text-ong-primary" strokeWidth={1.75} aria-hidden />
          <span className="flex-1">Scheduled</span>
          <span className="text-[13px] text-ong-muted">{counts.scheduled}</span>
        </NavLink>
        <NavLink to="/sent" className={({ isActive }) => itemClass(isActive)} onClick={onPick}>
          <Send className="h-[18px] w-[18px] text-ong-primary" strokeWidth={1.75} aria-hidden />
          <span className="flex-1">Sent</span>
          <span className="text-[13px] text-ong-muted">{counts.sent}</span>
        </NavLink>
        <NavLink to="/" end className={({ isActive }) => itemClass(isActive)} onClick={onPick}>
          <LayoutDashboard className="h-[18px] w-[18px] text-ong-primary" strokeWidth={1.75} aria-hidden />
          <span className="flex-1">Dashboard</span>
        </NavLink>
      </nav>
      <div className="mt-auto border-t border-ong-border p-4">
        <button type="button" onClick={onLogout} className="w-full rounded-[12px] px-3 py-2 text-left text-[13px] text-ong-muted hover:bg-ong-input">
          Log out
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-white">
      <div className="flex min-h-screen">
        <aside className="hidden w-[300px] shrink-0 flex-col border-r border-ong-border bg-white md:flex">
          <SidebarInner />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-ong-border bg-white px-4 py-3 md:hidden">
            <button type="button" onClick={() => setNavOpen((v) => !v)} className="rounded-[10px] border border-ong-border px-3 py-2 text-sm text-ong-text">Menu</button>
            <div className="text-sm font-bold tracking-[0.08em] text-ong-text">PULSE</div>
            <button type="button" onClick={() => navigate("/compose")} className="ong-btn-pill-outline !px-3 !py-1.5 text-xs">Compose</button>
          </header>
          {navOpen && (
            <div className="border-b border-ong-border bg-white md:hidden">
              <SidebarInner onPick={() => setNavOpen(false)} />
            </div>
          )}
          <main className="min-w-0 flex-1 bg-white">
            <Outlet context={{ openCompose: () => navigate("/compose"), reloadCounts: load, senders }} />
          </main>
        </div>
      </div>
    </div>
  );
}
