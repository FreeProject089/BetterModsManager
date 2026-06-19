// Visual session replay — plays the REAL recorded BMM DOM (rrweb) with the
// cursor, scroll and clicks, scaled to fit. Falls back to the event-based
// reconstruction (SessionReplay) when a session has no recording.
import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet } from "../lib/store";
import { SessionReplay } from "./replay";
import "rrweb/dist/style.css";

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function RrwebReplay({ sessionId, fallbackEvents }: { sessionId: string; fallbackEvents: any[] }) {
  const [evts, setEvts] = useState<any[] | null>(null);

  useEffect(() => {
    let on = true;
    setEvts(null);
    apiGet(`/api/replay?session_id=${encodeURIComponent(sessionId)}`)
      .then((r) => on && setEvts(r?.events || []))
      .catch(() => on && setEvts([]));
    return () => { on = false; };
  }, [sessionId]);

  if (evts === null) return <div className="text-sm text-sub py-6 text-center">Chargement du replay…</div>;
  if (evts.length < 2) {
    return (
      <div className="space-y-2">
        <div className="text-[11px] text-sub">Aucun enregistrement vidéo pour cette session — reconstruction à partir des événements.</div>
        <SessionReplay events={fallbackEvents} />
      </div>
    );
  }
  return <Player events={evts} />;
}

function Player({ events }: { events: any[] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const repRef = useRef<any>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [cur, setCur] = useState(0);
  const [total, setTotal] = useState(0);

  // recorded viewport (Meta event) → used to scale the player to fit the panel
  const [recW, recH] = useMemo(() => {
    const meta = events.find((e: any) => e.type === 4);
    return [meta?.data?.width || 1280, meta?.data?.height || 800];
  }, [events]);

  useEffect(() => {
    let raf = 0;
    let disposed = false;
    let rep: any;

    (async () => {
      const rrweb = await import("rrweb");
      if (disposed || !hostRef.current) return;
      hostRef.current.innerHTML = "";
      rep = new rrweb.Replayer(events, {
        root: hostRef.current,
        speed,
        skipInactive: true,
        showWarning: false,
        showDebug: false,
        mouseTail: { strokeStyle: "#5b8cff", lineWidth: 2 },
      });
      repRef.current = rep;
      const meta = rep.getMetaData();
      setTotal(meta.totalTime);

      const fit = () => {
        const box = boxRef.current;
        const wrapper = (rep as any).wrapper as HTMLElement | undefined;
        if (!box || !wrapper) return;
        const scale = Math.min(1, box.clientWidth / recW);
        wrapper.style.transform = `scale(${scale})`;
        wrapper.style.transformOrigin = "top left";
        box.style.height = `${recH * scale}px`;
      };
      fit();
      window.addEventListener("resize", fit);

      rep.on("finish", () => setPlaying(false));
      rep.play();
      const tick = () => {
        if (disposed) return;
        setCur(Math.min(rep.getCurrentTime(), meta.totalTime));
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);

      (rep as any).__fit = fit;
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      try { window.removeEventListener("resize", (rep as any)?.__fit); } catch {}
      try { rep?.pause?.(); } catch {}
      try { rep?.destroy?.(); } catch {}
    };
  }, [events, recW, recH]);

  const toggle = () => {
    const rep = repRef.current;
    if (!rep) return;
    if (playing) { rep.pause(); setPlaying(false); }
    else {
      if (cur >= total) { rep.play(0); } else { rep.play(rep.getCurrentTime()); }
      setPlaying(true);
    }
  };
  const changeSpeed = (s: number) => { setSpeed(s); try { repRef.current?.setConfig?.({ speed: s }); } catch {} };
  const seek = (ms: number) => {
    const rep = repRef.current;
    if (!rep) return;
    rep.play(ms);
    if (!playing) { rep.pause(); }
    setCur(ms);
  };

  return (
    <div className="space-y-3">
      <div ref={boxRef} className="relative w-full overflow-hidden rounded-xl border border-line bg-black" style={{ height: 320 }}>
        <div ref={hostRef} className="absolute inset-0" />
      </div>

      <div className="flex items-center gap-3">
        <button onClick={toggle} className="w-9 h-9 rounded-full bg-brand text-white grid place-items-center shrink-0" title={playing ? "Pause" : "Lecture"}>
          {playing ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5l12 7-12 7V5Z" /></svg>
          )}
        </button>

        <input
          type="range" min={0} max={total || 1} value={cur}
          onChange={(e) => seek(+e.target.value)}
          className="flex-1 accent-brand"
        />
        <span className="text-[11px] text-sub font-mono shrink-0">{mmss(cur)} / {mmss(total)}</span>

        <div className="flex gap-1 shrink-0">
          {[1, 2, 4, 8].map((s) => (
            <button key={s} onClick={() => changeSpeed(s)} className={`pill text-xs ${speed === s ? "bg-brand text-white" : "bg-panel2 text-sub"}`}>{s}×</button>
          ))}
        </div>
      </div>
    </div>
  );
}
