import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useStore } from "../lib/store";

const NAV: { to: string; label: string; icon: string }[] = [
  { to: "/", label: "Overview", icon: "M3 12h7V3H3v9Zm0 9h7v-7H3v7Zm11 0h7V12h-7v9Zm0-18v7h7V3h-7Z" },
  { to: "/live", label: "Live", icon: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 4v6l4 2" },
  { to: "/events", label: "Events", icon: "M13 2 3 14h7l-1 8 10-12h-7l1-8Z" },
  { to: "/sessions", label: "Sessions", icon: "M4 5h16M4 12h16M4 19h10" },
  { to: "/pages", label: "Pages & perf", icon: "M4 4h16v4H4Zm0 6h16v10H4Z" },
  { to: "/map", label: "Map", icon: "M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3Z" },
  { to: "/funnels", label: "Funnels", icon: "M3 4h18l-7 8v6l-4 2v-8L3 4Z" },
  { to: "/journeys", label: "Journeys", icon: "M4 19V5m0 14 4-3 4 3 4-3 4 3M4 5l4-3 4 3 4-3 4 3" },
  { to: "/retention", label: "Retention", icon: "M3 3v18h18M7 14l4-4 3 3 5-6" },
  { to: "/goals", label: "Goals", icon: "M12 2v20M2 12h20M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z" },
  { to: "/users", label: "Users", icon: "M16 21v-2a4 4 0 0 0-8 0v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" },
  { to: "/bmm", label: "BMM insights", icon: "M21 16V8l-9-5-9 5v8l9 5 9-5ZM3 8l9 5 9-5" },
  { to: "/admin", label: "Admin", icon: "M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6l-8-4Z" },
  { to: "/storage", label: "Stockage", icon: "M4 6a8 3 0 0 0 16 0 8 3 0 0 0-16 0Zm0 0v12a8 3 0 0 0 16 0V6M4 12a8 3 0 0 0 16 0" },
  { to: "/docs", label: "Documentation", icon: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15Z" },
];

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-brand">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

export default function Layout() {
  const { stats, connected, adminKey, setAdminKey } = useStore();
  const liveN = stats?.totals?.live ?? 0;
  const [navOpen, setNavOpen] = useState(false);
  return (
    <div className="flex h-full">
      {/* mobile backdrop */}
      {navOpen && <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setNavOpen(false)} />}

      <aside className={`fixed md:static z-40 h-full w-56 shrink-0 border-r border-line bg-panel flex flex-col transition-transform duration-200 ${navOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0`}>
        <div className="px-4 h-14 flex items-center gap-2 border-b border-line">
          <Logo />
          <div className="font-semibold tracking-tight">BMM Telemetry</div>
        </div>
        <nav className="p-2 flex-1 overflow-y-auto">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"} onClick={() => setNavOpen(false)} className={({ isActive }) => `navlink ${isActive ? "navlink-active" : ""}`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d={n.icon} />
              </svg>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-line text-[11px] text-sub">
          Privacy-first · approximate geo only
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 shrink-0 border-b border-line bg-panel/60 backdrop-blur flex items-center justify-between px-3 md:px-5 gap-2">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <button onClick={() => setNavOpen((o) => !o)} className="md:hidden p-1.5 -ml-1 rounded-lg hover:bg-panel2 shrink-0" aria-label="Menu">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 12h18M3 6h18M3 18h18" /></svg>
            </button>
            <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${connected ? "bg-good animate-pulse" : "bg-warn"}`} />
            <span className="text-sub hidden sm:inline">{connected ? "Live" : "Reconnecting…"}</span>
            <span className="text-sub mx-1 sm:mx-2 hidden sm:inline">·</span>
            <span className="font-medium">{liveN}</span>
            <span className="text-sub">online</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              placeholder="Admin key"
              type="password"
              className="bg-panel2 border border-line rounded-lg px-3 py-1.5 text-sm w-28 sm:w-40 focus:outline-none focus:border-brand"
            />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-3 md:p-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
