import { useState } from "react";
import { Route, Routes } from "react-router-dom";
import { StoreProvider, useStats, useStore } from "./lib/store";
import Layout from "./components/Layout";
import Overview from "./pages/Overview";
import Live from "./pages/Live";
import Events from "./pages/Events";
import Sessions from "./pages/Sessions";
import Pages from "./pages/Pages";
import MapPage from "./pages/MapPage";
import Funnels from "./pages/Funnels";
import Journeys from "./pages/Journeys";
import Retention from "./pages/Retention";
import Goals from "./pages/Goals";
import Users from "./pages/Users";
import UserDetail from "./pages/UserDetail";
import Bmm from "./pages/Bmm";
import Admin from "./pages/Admin";

function Gate({ children }: { children: React.ReactNode }) {
  const stats = useStats();
  if (!stats) {
    return (
      <div className="h-full flex items-center justify-center text-sub">
        <div className="flex items-center gap-3">
          <span className="w-4 h-4 rounded-full border-2 border-brand border-t-transparent animate-spin" />
          Connecting to telemetry stream…
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

// Full-screen login shown when the dashboard requires the private key.
function Login() {
  const { setAdminKey } = useStore();
  const [k, setK] = useState("");
  return (
    <div className="h-full flex items-center justify-center">
      <form
        onSubmit={(e) => { e.preventDefault(); if (k.trim()) setAdminKey(k.trim()); }}
        className="card p-6 w-80 space-y-3"
      >
        <div className="flex items-center gap-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-brand">
            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <div className="font-semibold">BMM Telemetry — private</div>
        </div>
        <p className="text-xs text-sub">This dashboard is locked. Enter the admin key to view any data.</p>
        <input
          autoFocus
          type="password"
          value={k}
          onChange={(e) => setK(e.target.value)}
          placeholder="Admin key (bmm_sk_…)"
          className="w-full bg-panel2 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand"
        />
        <button type="submit" className="w-full bg-brand text-white rounded-lg px-4 py-2 text-sm font-medium">Unlock</button>
      </form>
    </div>
  );
}

function Shell() {
  const { authError } = useStore();
  if (authError) {
    return (
      <div className="h-full bg-bg text-ink">
        <Login />
      </div>
    );
  }
  return (
    <Routes>
        <Route element={<Layout />}>
          <Route index element={<Gate><Overview /></Gate>} />
          <Route path="live" element={<Gate><Live /></Gate>} />
          <Route path="events" element={<Gate><Events /></Gate>} />
          <Route path="sessions" element={<Gate><Sessions /></Gate>} />
          <Route path="pages" element={<Gate><Pages /></Gate>} />
          <Route path="map" element={<Gate><MapPage /></Gate>} />
          <Route path="funnels" element={<Gate><Funnels /></Gate>} />
          <Route path="journeys" element={<Gate><Journeys /></Gate>} />
          <Route path="retention" element={<Gate><Retention /></Gate>} />
          <Route path="goals" element={<Gate><Goals /></Gate>} />
          <Route path="users" element={<Gate><Users /></Gate>} />
          <Route path="users/:id" element={<Gate><UserDetail /></Gate>} />
          <Route path="bmm" element={<Gate><Bmm /></Gate>} />
          <Route path="admin" element={<Gate><Admin /></Gate>} />
        </Route>
      </Routes>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
