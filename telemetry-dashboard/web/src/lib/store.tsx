import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Stats } from "./types";

interface StoreValue {
  stats: Stats | null;
  connected: boolean;
  adminKey: string;
  setAdminKey: (k: string) => void;
}

const Ctx = createContext<StoreValue>(null as any);
export const useStore = () => useContext(Ctx);
export const useStats = () => useContext(Ctx).stats;

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [connected, setConnected] = useState(false);
  const [adminKey, setAdminKeyState] = useState(() => localStorage.getItem("bmm_admin_key") || "");
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<number | null>(null);

  const setAdminKey = (k: string) => {
    localStorage.setItem("bmm_admin_key", k);
    setAdminKeyState(k);
  };

  useEffect(() => {
    let closed = false;
    const startPoll = () => {
      if (pollRef.current) return;
      const tick = async () => {
        try {
          const r = await fetch("/api/stats");
          if (r.ok) setStats(await r.json());
        } catch {
          /* ignore */
        }
      };
      tick();
      pollRef.current = window.setInterval(tick, 10000);
    };
    const connect = () => {
      try {
        const es = new EventSource("/api/stream");
        esRef.current = es;
        es.onopen = () => {
          setConnected(true);
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
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
    connect();
    return () => {
      closed = true;
      esRef.current?.close();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  return <Ctx.Provider value={{ stats, connected, adminKey, setAdminKey }}>{children}</Ctx.Provider>;
}

// ── REST helpers (drill-downs + admin writes) ───────────────────────────────
export async function apiGet<T = any>(url: string): Promise<T> {
  const r = await fetch(url);
  return r.json();
}
export async function apiPost<T = any>(url: string, body: any, adminKey?: string): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(adminKey ? { "X-Admin-Key": adminKey } : {}) },
    body: JSON.stringify(body),
  });
  return r.json();
}
export async function apiDelete<T = any>(url: string, adminKey?: string): Promise<T> {
  const r = await fetch(url, { method: "DELETE", headers: adminKey ? { "X-Admin-Key": adminKey } : {} });
  return r.json();
}
