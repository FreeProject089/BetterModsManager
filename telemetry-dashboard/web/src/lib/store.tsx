import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Stats } from "./types";

interface StoreValue {
  stats: Stats | null;
  connected: boolean;
  authError: boolean;
  adminKey: string;
  setAdminKey: (k: string) => void;
}

const Ctx = createContext<StoreValue>(null as any);
export const useStore = () => useContext(Ctx);
export const useStats = () => useContext(Ctx).stats;

// The viewer key is the private admin key; it gates every data endpoint.
const key = () => localStorage.getItem("bmm_admin_key") || "";

// A stable per-browser fingerprint (classic UA + locale + screen + tz + a
// persistent salt) sent on every request so the server can attribute admin
// actions (downloads / deletes / backups) in the audit log.
function fingerprint(): string {
  try {
    let fp = localStorage.getItem("bmm_admin_fp");
    if (!fp) {
      const seed = [navigator.userAgent, navigator.language, `${screen.width}x${screen.height}x${screen.colorDepth}`, Intl.DateTimeFormat().resolvedOptions().timeZone, Math.random().toString(36).slice(2)].join("|");
      let h = 5381;
      for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0;
      fp = h.toString(16) + Date.now().toString(36);
      localStorage.setItem("bmm_admin_fp", fp);
    }
    return fp;
  } catch { return "unknown"; }
}
const authHeaders = (): Record<string, string> => ({ ...(key() ? { "X-Admin-Key": key() } : {}), "X-Admin-Fp": fingerprint() });

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [connected, setConnected] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [adminKey, setAdminKeyState] = useState(() => localStorage.getItem("bmm_admin_key") || "");
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<number | null>(null);

  const setAdminKey = (k: string) => {
    localStorage.setItem("bmm_admin_key", k);
    setAdminKeyState(k);
  };

  useEffect(() => {
    let closed = false;
    const clearPoll = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    const startPoll = () => {
      if (pollRef.current) return;
      const tick = async () => {
        try {
          const r = await fetch("/api/stats", { headers: authHeaders() });
          if (r.status === 401) {
            setAuthError(true);
            clearPoll();
            return;
          }
          if (r.ok) {
            setAuthError(false);
            setStats(await r.json());
          }
        } catch {
          /* ignore */
        }
      };
      tick();
      pollRef.current = window.setInterval(tick, 10000);
    };
    // Probe auth first: 401 → show login; otherwise open the live stream.
    const start = async () => {
      try {
        const r = await fetch("/api/stats", { headers: authHeaders() });
        if (r.status === 401) {
          setAuthError(true);
          return;
        }
        setAuthError(false);
        if (r.ok) setStats(await r.json());
      } catch {
        /* offline — fall through to SSE/poll which will retry */
      }
      connect();
    };
    const connect = () => {
      try {
        // EventSource can't set headers, so pass the key as a query param.
        const k = key();
        const es = new EventSource(`/api/stream${k ? `?key=${encodeURIComponent(k)}` : ""}`);
        esRef.current = es;
        es.onopen = () => {
          setConnected(true);
          setAuthError(false);
          clearPoll();
        };
        es.onmessage = (e) => {
          try {
            setStats(JSON.parse(e.data));
          } catch {
            /* ignore */
          }
        };
        es.onerror = () => {
          setConnected(false);
          es.close();
          esRef.current = null;
          startPoll();
          if (!closed) setTimeout(connect, 4000);
        };
      } catch {
        startPoll();
      }
    };
    start();
    return () => {
      closed = true;
      esRef.current?.close();
      clearPoll();
    };
  }, [adminKey]);

  return <Ctx.Provider value={{ stats, connected, authError, adminKey, setAdminKey }}>{children}</Ctx.Provider>;
}

// ── REST helpers (drill-downs + admin writes) — all carry the viewer key ────
export async function apiGet<T = any>(url: string): Promise<T> {
  const r = await fetch(url, { headers: authHeaders() });
  return r.json();
}
export async function apiPost<T = any>(url: string, body: any, adminKey?: string): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(adminKey ? { "X-Admin-Key": adminKey } : {}) },
    body: JSON.stringify(body),
  });
  return r.json();
}
export async function apiDelete<T = any>(url: string, adminKey?: string): Promise<T> {
  const r = await fetch(url, { method: "DELETE", headers: { ...authHeaders(), ...(adminKey ? { "X-Admin-Key": adminKey } : {}) } });
  return r.json();
}
