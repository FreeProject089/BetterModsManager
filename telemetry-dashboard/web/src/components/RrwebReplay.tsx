// Visual session replay — plays the REAL recorded BMM DOM (rrweb) with the
// cursor, scroll and clicks, scaled to fit. Falls back to the event-based
// reconstruction (SessionReplay) when a session has no recording.
import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet } from "../lib/store";
import { SessionReplay } from "./replay";
import { classify, eventLabel, eventLocation, buildModalTitles, EvIcon, TYPES } from "./events";
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
  return <Player events={evts} markers={fallbackEvents} />;
}

function Player({ events, markers }: { events: any[]; markers: any[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const repRef = useRef<any>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [cur, setCur] = useState(0);
  const [total, setTotal] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

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
      setStartTime(meta.startTime);

      const fit = () => {
        const box = boxRef.current;
        const wrapper = (rep as any).wrapper as HTMLElement | undefined;
        if (!box || !wrapper) return;
        const boxW = box.clientWidth;
        const isFS = !!document.fullscreenElement;
        const maxH = isFS ? box.clientHeight : Math.min(window.innerHeight * 0.6, 560);
        
        let scale = boxW / recW;
        if (recH * scale > maxH) scale = maxH / recH;
        wrapper.style.position = "absolute";
        wrapper.style.transformOrigin = "top left";
        wrapper.style.transform = `scale(${scale})`;
        wrapper.style.left = `${Math.max(0, (boxW - recW * scale) / 2)}px`;
        wrapper.style.top = `${Math.max(0, (maxH - recH * scale) / 2)}px`;
        if (!isFS) box.style.height = `${recH * scale}px`;
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

  useEffect(() => {
    const onFs = () => {
      const isFS = !!document.fullscreenElement;
      setIsFullscreen(isFS);
      if (repRef.current && repRef.current.__fit) {
        setTimeout(repRef.current.__fit, 50); // slight delay to allow layout recalculation
      }
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const toggle = () => {
    const rep = repRef.current;
    if (!rep) return;
    if (playing) { rep.pause(); setPlaying(false); }
    else {
      if (cur >= total) { rep.play(0); } else { rep.play(rep.getCurrentTime()); }
      setPlaying(true);
    }
  };

  const exportBmmReplay = () => {
    const json = JSON.stringify({
      bmmReplay: 1,
      app: "BetterModsManager",
      createdAt: new Date().toISOString(),
      masked: false,
      events
    });
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `bmm-replay-${Date.now()}.bmmreplay`;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };
  const changeSpeed = (s: number) => { setSpeed(s); try { repRef.current?.setConfig?.({ speed: s }); } catch {} };
  const seek = (ms: number) => {
    const rep = repRef.current;
    if (!rep) return;
    rep.play(ms);
    if (!playing) { rep.pause(); }
    setCur(ms);
  };

  // Telemetry events overlaid as markers on the timeline (what happened + when).
  const titles = useMemo(() => buildModalTitles(markers || []), [markers]);
  const markPts = useMemo(() => {
    if (!startTime || !total) return [] as any[];
    return (markers || [])
      .filter((e: any) => e.event !== "page_leave" && e.event !== "perf" && e.event !== "$replay" && !e.event?.startsWith("$log_"))
      .map((e: any) => ({ off: new Date(e.ts).getTime() - startTime, type: classify(e), label: eventLabel(e), loc: eventLocation(e, titles) }))
      .filter((m: any) => m.off >= 0 && m.off <= total);
  }, [markers, startTime, total, titles]);
  const curEvent = useMemo(() => { let last: any = null; for (const m of markPts) { if (m.off <= cur) last = m; else break; } return last; }, [markPts, cur]);

  const logs = useMemo(() => {
    if (!startTime) return [];
    const list: any[] = [];
    for (const e of markers) {
      if (e.event === '$log_js') {
        list.push({ off: new Date(e.ts).getTime() - startTime, type: 'JS', level: e.level || 'info', msg: e.msg || '' });
      } else if (e.event === '$log_rust') {
        const lines = (e.log || '').split('\n').filter(Boolean);
        for (const line of lines) {
          list.push({ off: new Date(e.ts).getTime() - startTime, type: 'Rust', level: line.toLowerCase().includes('error') ? 'error' : 'warn', msg: line });
        }
      }
    }
    return list.sort((a, b) => a.off - b.off);
  }, [markers, startTime]);

  return (
    <div ref={containerRef} className={isFullscreen ? 'bg-[#0f1115] p-6 h-full w-full flex flex-col gap-3 overflow-hidden text-ink' : 'space-y-3'}>
      <div className={`flex gap-3 ${isFullscreen ? 'flex-1 min-h-0 flex-col md:flex-row' : 'flex-col'}`}>
        <div ref={boxRef} className={`relative w-full overflow-hidden rounded-xl border border-line bg-black ${isFullscreen ? 'flex-1' : ''}`} style={isFullscreen ? {} : { height: 320 }}>
          <div ref={hostRef} className="absolute inset-0" />
        </div>

        {logs.length > 0 && (
          <div className={`bg-panel2 rounded-xl border border-line flex flex-col ${isFullscreen ? 'md:w-[400px] md:h-full h-48 shrink-0' : 'h-48'}`}>
            <div className="px-3 py-2 border-b border-line text-[11px] font-semibold text-sub tracking-wide uppercase flex justify-between shrink-0">
              <span>Live Logs</span>
              <span>{logs.length} entries</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 font-mono text-[10px] space-y-1">
              {logs.map((log, i) => {
                const past = log.off <= cur;
                const color = log.level === 'error' ? 'text-[var(--danger)]' : 'text-[var(--warning)]';
                return (
                  <div key={i} className={`flex gap-2 ${past ? color : 'text-sub opacity-30'} ${Math.abs(log.off - cur) < 1500 ? 'bg-[var(--line)]/30' : ''}`}>
                    <span className="shrink-0">{mmss(log.off)}</span>
                    <span className="shrink-0 w-8">[{log.type}]</span>
                    <span className="break-all whitespace-pre-wrap">{log.msg}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* current action (synced with playback) */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-panel2 border border-line min-h-[34px]">
        {curEvent ? <><EvIcon type={curEvent.type} size={14} /><span className="text-sm truncate">{curEvent.label}</span>{curEvent.loc ? <span className="text-[11px] text-sub truncate">· {curEvent.loc}</span> : null}</> : <span className="text-[11px] text-sub">—</span>}
      </div>

      <div className="flex items-center gap-3">
        <button onClick={toggle} className="w-9 h-9 rounded-full bg-brand text-white grid place-items-center shrink-0" title={playing ? "Pause" : "Lecture"}>
          {playing ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5l12 7-12 7V5Z" /></svg>
          )}
        </button>

        <div className="relative flex-1">
          {/* event markers above the scrubber */}
          <div className="relative h-3 mb-0.5">
            {markPts.map((m, i) => (
              <button
                key={i}
                onClick={() => seek(m.off)}
                title={`${mmss(m.off)} · ${m.label}${m.loc ? " — " + m.loc : ""}`}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full hover:scale-150 transition-transform"
                style={{ left: `${(m.off / total) * 100}%`, background: (TYPES as any)[m.type].color }}
              />
            ))}
          </div>
          <input type="range" min={0} max={total || 1} value={cur} onChange={(e) => seek(+e.target.value)} className="w-full accent-brand" />
        </div>
        <span className="text-[11px] text-sub font-mono shrink-0">{mmss(cur)} / {mmss(total)}</span>

        <div className="flex gap-1 shrink-0">
          {[1, 2, 4, 8].map((s) => (
            <button key={s} onClick={() => changeSpeed(s)} className={`pill text-xs ${speed === s ? "bg-brand text-white" : "bg-panel2 text-sub"}`}>{s}×</button>
          ))}
          <button onClick={exportBmmReplay} className="pill text-xs ml-2 bg-panel2 text-sub hover:text-ink transition-opacity" title="Exporter en .bmmreplay">
            <span className="flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export
            </span>
          </button>
          <button onClick={toggleFullscreen} className="pill text-xs bg-panel2 text-sub hover:text-ink ml-2" title="Fullscreen">
            {isFullscreen ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
