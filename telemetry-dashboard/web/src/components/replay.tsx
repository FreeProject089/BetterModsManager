// Session replay — reconstructs a BMM session as a watchable playback from the
// event stream (page_enter / clicks / modals / …). No DOM recording: each event
// already carries the page + modal it happened in, so we rebuild the "screen"
// state frame by frame and animate it on the real timeline (idle gaps capped so
// it stays watchable). Inspired by Rybbit's replay, kept light & privacy-safe.
import { useEffect, useMemo, useRef, useState } from "react";
import { classify, eventLabel, eventLocation, humanizeModal, buildModalTitles, EvIcon, TYPES, type TypeKey } from "./events";

const MAX_GAP = 2500; // compress idle gaps between events to at most 2.5s

type Frame = {
  e: any;
  view: string;
  modal: string;
  modalTitle: string;
  type: TypeKey;
  label: string;
  loc: string;
  realMs: number; // true ms since session start
  offMs: number;  // position in the compressed playback timeline
};

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function SessionReplay({ events }: { events: any[] }) {
  const titles = useMemo(() => buildModalTitles(events), [events]);

  const frames = useMemo<Frame[]>(() => {
    const evs = (events || []).filter((e) => e.event !== "page_leave" && e.event !== "perf");
    if (!evs.length) return [];
    const t0 = new Date(evs[0].ts).getTime();
    let lastView = "";
    let off = 0;
    let prevReal = 0;
    return evs.map((e, i) => {
      const realMs = new Date(e.ts).getTime() - t0;
      if (i > 0) off += Math.min(Math.max(0, realMs - prevReal), MAX_GAP);
      prevReal = realMs;
      if (e.view) lastView = e.view;
      const modal = e.modal || "";
      return {
        e,
        view: e.view || lastView,
        modal,
        modalTitle: humanizeModal(modal, titles),
        type: classify(e),
        label: eventLabel(e),
        loc: eventLocation(e, titles),
        realMs,
        offMs: off,
      };
    });
  }, [events, titles]);

  const total = frames.length ? frames[frames.length - 1].offMs : 0;
  const navViews = useMemo(() => {
    const seen: string[] = [];
    for (const f of frames) if (f.view && !seen.includes(f.view)) seen.push(f.view);
    return seen.slice(0, 9);
  }, [frames]);

  const [clock, setClock] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const clockRef = useRef(0);
  clockRef.current = clock;

  useEffect(() => {
    if (!playing || !total) return;
    const id = setInterval(() => {
      const next = clockRef.current + 50 * speed;
      if (next >= total) { setClock(total); setPlaying(false); }
      else setClock(next);
    }, 50);
    return () => clearInterval(id);
  }, [playing, speed, total]);

  const idx = useMemo(() => {
    let lo = 0;
    for (let i = 0; i < frames.length; i++) { if (frames[i].offMs <= clock) lo = i; else break; }
    return lo;
  }, [clock, frames]);

  if (!frames.length) return <div className="text-sm text-sub py-6 text-center">Pas d'événements à rejouer.</div>;
  const cur = frames[idx];
  const atEnd = idx >= frames.length - 1 && clock >= total;
  const interactive = cur.type === "click" || cur.type === "form" || cur.type === "input" || cur.type === "copy";

  const togglePlay = () => {
    if (atEnd) { setClock(0); setPlaying(true); }
    else setPlaying((p) => !p);
  };

  return (
    <div className="space-y-3">
      {/* ── reconstructed screen ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-line bg-[#0b0d10] overflow-hidden shadow-lg">
        <div className="flex items-center gap-2 px-3 py-2 bg-panel2 border-b border-line">
          <span className="flex gap-1.5">
            <i className="w-2.5 h-2.5 rounded-full bg-[#f06363] inline-block" />
            <i className="w-2.5 h-2.5 rounded-full bg-[#f4b740] inline-block" />
            <i className="w-2.5 h-2.5 rounded-full bg-[#37d399] inline-block" />
          </span>
          <span className="text-xs text-sub truncate">BetterModsManager — {cur.view || "—"}</span>
          <span className="ml-auto text-[11px] text-sub font-mono">{mmss(cur.realMs)} / {mmss(frames[frames.length - 1].realMs)}</span>
        </div>

        <div className="flex h-[280px]">
          {/* nav rail */}
          <div className="w-36 shrink-0 border-r border-line p-2 space-y-1 bg-panel/30 overflow-y-auto">
            {navViews.map((v) => (
              <div key={v} className={`px-2 py-1.5 rounded-md text-xs truncate transition-colors ${v === cur.view ? "bg-brand/20 text-brand font-medium" : "text-sub"}`}>
                {v}
              </div>
            ))}
          </div>

          {/* main viewport */}
          <div className="relative flex-1 p-5 overflow-hidden">
            <div className="text-[11px] text-sub">{cur.loc || cur.view}</div>
            <div className="text-xl font-semibold mt-1">{cur.view || "—"}</div>

            {/* a pulsing ripple for interactive actions on the page */}
            {interactive && !cur.modal && (
              <span key={`r-${idx}`} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                <span className="absolute inset-0 w-10 h-10 -m-5 rounded-full bg-brand/30 animate-ping" />
                <span className="block w-3 h-3 rounded-full" style={{ background: TYPES[cur.type].color }} />
              </span>
            )}

            {/* modal overlay reconstruction */}
            {cur.modal && (
              <div className="absolute inset-0 bg-black/55 grid place-items-center p-4" key={`m-${cur.modal}`}>
                <div className="w-72 rounded-xl border border-line bg-panel2 p-4 shadow-2xl">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2 h-2 rounded-full bg-brand" />
                    <div className="text-sm font-semibold truncate">{cur.modalTitle || "Modal"}</div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-sub">
                    <EvIcon type={cur.type} size={14} />
                    <span className="truncate">{cur.label}</span>
                    {interactive && <span className="ml-auto w-2 h-2 rounded-full bg-brand animate-ping" />}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── current action ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-panel2 border border-line">
        <EvIcon type={cur.type} />
        <div className="min-w-0 flex-1">
          <div className="text-sm truncate">{cur.label}</div>
          {cur.loc && cur.type !== "page" ? <div className="text-[11px] text-sub truncate">{cur.loc}</div> : null}
        </div>
        <span className="text-[11px] text-sub font-mono shrink-0">#{idx + 1}/{frames.length}</span>
      </div>

      {/* ── controls + scrubber ──────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <button onClick={togglePlay} className="w-9 h-9 rounded-full bg-brand text-white grid place-items-center shrink-0" title={playing ? "Pause" : "Lecture"}>
          {playing ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
          ) : atEnd ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5l12 7-12 7V5Z" /></svg>
          )}
        </button>

        <div className="relative flex-1 h-6">
          {/* event ticks */}
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-panel2 overflow-hidden">
            <div className="h-full bg-brand/60" style={{ width: total ? `${(clock / total) * 100}%` : "0%" }} />
          </div>
          {frames.map((f, i) => (
            <button
              key={i}
              onClick={() => { setClock(f.offMs); setPlaying(false); }}
              title={`${f.label}${f.loc ? " · " + f.loc : ""}`}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full hover:scale-150 transition-transform"
              style={{ left: total ? `${(f.offMs / total) * 100}%` : "0%", background: i === idx ? "#fff" : TYPES[f.type].color, opacity: i === idx ? 1 : 0.6 }}
            />
          ))}
        </div>

        <div className="flex gap-1 shrink-0">
          {[1, 2, 4, 8].map((s) => (
            <button key={s} onClick={() => setSpeed(s)} className={`pill text-xs ${speed === s ? "bg-brand text-white" : "bg-panel2 text-sub"}`}>{s}×</button>
          ))}
        </div>
      </div>
    </div>
  );
}
