import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { createRoot, type Root } from "react-dom/client";
import { useStats, apiGet } from "../lib/store";
import { Drawer } from "../components/ui";
import { ProfileAvatar, Flag } from "../components/visuals";
import { fmtDateTime, dur, nf } from "../lib/format";

// Light raster basemap (CARTO Voyager) — no API key, looks like the Rybbit map.
const STYLE: any = {
  version: 8,
  glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
  sources: {
    base: {
      type: "raster",
      tiles: ["https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap © CARTO",
    },
  },
  layers: [{ id: "base", type: "raster", source: "base" }],
};

type Tab = "chrono" | "points" | "pays";

export default function MapPage() {
  const s = useStats()!;
  const navigate = useNavigate();
  const [mode, setMode] = useState<"2d" | "globe">("globe");
  const [tab, setTab] = useState<Tab>("points");
  const [sessions, setSessions] = useState<any[]>([]);
  const [repoSel, setRepoSel] = useState<any | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // markers carry start/end (ms) when they represent a timeline session.
  const markersRef = useRef<{ m: maplibregl.Marker; root: Root; start?: number; end?: number }[]>([]);
  const [t, setT] = useState(0);        // timeline scrub position (ms)
  const [playing, setPlaying] = useState(false);

  const users = s.map?.users || [];
  const repos = s.map?.repos || [];
  const total = users.length + repos.length;
  const maxC = Math.max(1, ...(s.geo || []).map((g: any) => g.count));

  const ccOf = (id: string) => s.users.find((u) => u.creator_id === id)?.cc;

  // ── Timeline: join sessions (times) with each user's map point (location) ──
  const userPoint = useMemo(() => {
    const m: Record<string, any> = {};
    for (const u of users) m[u.creator_id] = u;
    return m;
  }, [users]);
  const timeline = useMemo(() => {
    return sessions
      .map((se: any) => {
        const up = userPoint[se.distinct_id];
        const start = Date.parse(se.start);
        if (!up || isNaN(start)) return null;
        const end = Date.parse(se.end);
        return { id: se.session_id, did: se.distinct_id, start, end: isNaN(end) ? start + 60000 : Math.max(end, start + 30000), lat: up.lat, lon: up.lon, country: up.country, entry: se.entry, exit: se.exit, dur: se.duration_s, pv: se.pageviews };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.start - b.start) as any[];
  }, [sessions, userPoint]);
  const tRange = useMemo(() => {
    if (!timeline.length) return [0, 0];
    let lo = Infinity, hi = -Infinity;
    for (const e of timeline) { lo = Math.min(lo, e.start); hi = Math.max(hi, e.end); }
    return [lo, hi];
  }, [timeline]);
  // active sessions at the scrub time (or all recent when t not set)
  const activeAtT = useMemo(() => timeline.filter((e: any) => t >= e.start && t <= e.end), [timeline, t]);

  // recent sessions for the live panel
  useEffect(() => {
    const load = () => apiGet("/api/sessions").then((r) => setSessions(r.sessions || []));
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  // create the map once
  useEffect(() => {
    if (!boxRef.current || mapRef.current) return;
    let mounted = true;
    const map = new maplibregl.Map({
      container: boxRef.current,
      style: STYLE,
      center: [10, 35],
      zoom: 1.4,
      attributionControl: false,
      maxPitch: 0,
      trackResize: true,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    // Silence WebGL worker errors that fire after unmount
    map.on("error", () => { });
    map.on("load", () => {
      if (!mounted) return;
      try { map.setProjection({ type: mode === "globe" ? "globe" : "mercator" } as any); } catch { }
      // country choropleth source (local, offline-safe)
      fetch("/world.json").then((r) => r.json()).then((geo) => {
        if (!mounted) return;
        try {
          if (!map.getSource("countries")) {
            map.addSource("countries", { type: "geojson", data: geo });
            map.addLayer({
              id: "country-fill",
              type: "fill",
              source: "countries",
              layout: { visibility: "none" },
              paint: { "fill-color": "rgba(91,140,255,0.05)", "fill-outline-color": "rgba(255,255,255,0.15)" },
            });
          }
          applyChoropleth();
        } catch { }
      }).catch(() => { });
      try { rebuildMarkers(); } catch { }
    });
    return () => {
      mounted = false;
      markersRef.current.forEach((x) => { try { x.root.unmount(); } catch { } try { x.m.remove(); } catch { } });
      markersRef.current = [];
      try { map.remove(); } catch { }
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // projection toggle
  useEffect(() => {
    const map = mapRef.current;
    if (map && map.isStyleLoaded()) {
      try { map.setProjection({ type: mode === "globe" ? "globe" : "mercator" } as any); } catch { }
    }
  }, [mode]);

  // avatar markers for located users (limited for performance). In "chrono"
  // mode the user markers come from the session timeline (each carries start/end)
  // so scrubbing can light up who was connected when.
  const rebuildMarkers = () => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    markersRef.current.forEach((x) => { try { x.root.unmount(); } catch { } try { x.m.remove(); } catch { } });
    markersRef.current = [];
    const userPts =
      tab === "chrono"
        ? timeline.slice(0, 300).map((e: any) => ({ kind: "user", creator_id: e.did, lat: e.lat, lon: e.lon, country: e.country, start: e.start, end: e.end }))
        : users.slice(0, 200).map((u: any) => ({ ...u, kind: "user" }));
    const pts = [...userPts, ...repos.map((r: any) => ({ ...r, kind: "repo" }))];
    for (const p of pts) {
      if (p.lon == null || p.lat == null) continue;
      try {
        const el = document.createElement("div");
        el.style.cursor = "pointer";
        el.title = p.kind === "repo"
          ? `${p.host || ""} · ${p.count} connection(s) — click for details`
          : `${p.creator_id || ""}${p.country ? " · " + p.country : ""} — click to open profile`;
        const root = createRoot(el);
        root.render(
          p.kind === "user" ? (
            // SAME avatar seed (creator_id) as everywhere else → matches the user's pfp
            <div className="rounded-full ring-2 ring-white/40 shadow" style={{ width: 30, height: 30, overflow: "hidden" }}>
              <ProfileAvatar name={p.creator_id || p.country || "anon"} size={30} />
            </div>
          ) : (
            <div className="rounded-full ring-2 ring-white/50 shadow flex items-center justify-center" style={{ width: 28, height: 28, background: "#a78bfa", color: "#0b0d10" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3Z" /></svg>
            </div>
          )
        );
        el.addEventListener("click", () => {
          if (p.kind === "user" && p.creator_id) {
            navigate(`/users/${encodeURIComponent(p.creator_id)}`);
          } else if (p.kind === "repo") {
            // open the matching repo.json entry (full host details)
            const full = (s.repos || []).find((r: any) => r.host === p.host) || p;
            setRepoSel(full);
          }
        });
        const m = new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map);
        markersRef.current.push({ m, root, start: p.start, end: p.end });
      } catch { /* skip bad coords silently */ }
    }
    if (tab === "chrono") applyTimelineVis();
  };

  // dim timeline markers that aren't active at the current scrub time
  const applyTimelineVis = () => {
    for (const x of markersRef.current) {
      if (x.start == null) continue; // repos / static markers stay visible
      const active = t >= x.start && t <= (x.end ?? x.start);
      const el = x.m.getElement();
      el.style.opacity = active ? "1" : "0.10";
      el.style.zIndex = active ? "3" : "0";
      el.style.transition = "opacity .25s ease";
    }
  };

  // choropleth (Pays = countries shaded by user count)
  const applyChoropleth = () => {
    const map = mapRef.current;
    if (!map || !map.getLayer("country-fill")) return;
    if (tab === "pays") {
      const geos = s.geo || [];
      if (geos.length === 0) {
        map.setPaintProperty("country-fill", "fill-color", "rgba(255,255,255,0.02)");
      } else {
        const expr: any[] = ["match", ["get", "name"]];
        for (const g of geos) {
          const a = Math.max(0.15, Math.min(0.85, g.count / maxC));
          expr.push(g.country, `rgba(55,211,153,${a})`);
        }
        expr.push("rgba(255,255,255,0.02)");
        map.setPaintProperty("country-fill", "fill-color", expr as any);
      }
      map.setLayoutProperty("country-fill", "visibility", "visible");
    } else {
      map.setLayoutProperty("country-fill", "visibility", "none");
    }
  };

  // re-apply when data/tab/sessions change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    try { rebuildMarkers(); } catch { }
    try { applyChoropleth(); } catch { }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, s.updated, sessions]);

  // entering Chronologie (or new range) → jump scrub to the most recent moment
  useEffect(() => {
    if (tab === "chrono" && tRange[1] > 0) setT(tRange[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, tRange[0], tRange[1]]);

  // scrubbing → light up the markers active at t (no marker rebuild)
  useEffect(() => {
    if (tab === "chrono") applyTimelineVis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, tab]);

  // play: sweep the scrub across the range and loop
  useEffect(() => {
    if (!playing || tab !== "chrono" || tRange[1] <= tRange[0]) return;
    const span = tRange[1] - tRange[0];
    const id = setInterval(() => {
      setT((prev) => { const next = prev + span / 160; return next >= tRange[1] ? tRange[0] : next; });
    }, 90);
    return () => clearInterval(id);
  }, [playing, tab, tRange[0], tRange[1]]);

  const TABS: { k: Tab; label: string }[] = useMemo(() => [
    { k: "chrono", label: "Chronologie" },
    { k: "points", label: "Coordonnées" },
    { k: "pays", label: "Pays" },
  ], []);

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Geography</h2>
          <span className="text-xs text-sub">approximate only — never precise · {users.length} users · {repos.length} repos</span>
        </div>
        <div className="flex gap-1">
          {TABS.map((tb) => (
            <button key={tb.k} onClick={() => setTab(tb.k)} className={`pill ${tab === tb.k ? "bg-brand text-white" : "bg-panel2 text-sub"}`}>{tb.label}</button>
          ))}
          <span className="w-px bg-line mx-1" />
          <button onClick={() => setMode("2d")} className={`pill ${mode === "2d" ? "bg-brand text-white" : "bg-panel2 text-sub"}`}>2D</button>
          <button onClick={() => setMode("globe")} className={`pill ${mode === "globe" ? "bg-brand text-white" : "bg-panel2 text-sub"}`}>3D globe</button>
        </div>
      </div>

      <div className="relative card overflow-hidden h-[60vh] md:h-[620px]">
        <div ref={boxRef} style={{ position: "absolute", inset: 0 }} />
        {total === 0 && (
          <div className="absolute inset-x-0 bottom-3 text-center text-xs text-sub pointer-events-none">
            No located users yet — locations resolve server-side from each client's IP once users opt in.
          </div>
        )}
        {/* sessions panel — in Chronologie it lists who was connected at the scrub time */}
        <div className="absolute right-3 bottom-3 w-72 max-h-[55%] overflow-y-auto card bg-panel/90 backdrop-blur p-2">
          <div className="text-[11px] uppercase tracking-wide text-sub px-1 pb-1">
            {tab === "chrono" ? `Connected · ${activeAtT.length}` : "Sessions"}
          </div>
          {(tab === "chrono" ? activeAtT : sessions).length ? (
            (tab === "chrono" ? activeAtT : sessions).slice(0, 10).map((r: any) => (
              <Link to={`/users/${encodeURIComponent(r.distinct_id || r.did)}`} key={r.session_id || r.id} className="flex items-center gap-2 px-1 py-1.5 rounded-lg hover:bg-panel2 text-xs">
                <ProfileAvatar name={r.distinct_id || r.did} size={20} />
                <Flag cc={ccOf(r.distinct_id || r.did)} />
                <span className="truncate flex-1">{r.entry || "—"} → {r.exit || "—"}</span>
                <span className="text-sub">{dur(r.dur ?? r.duration_s)}</span>
              </Link>
            ))
          ) : (
            <div className="text-xs text-sub px-1 py-2">{tab === "chrono" ? "Nobody connected at this moment." : "No sessions."}</div>
          )}
        </div>

        {/* Timeline scrubber (Chronologie) */}
        {tab === "chrono" && timeline.length > 0 && (
          <div className="absolute left-3 right-80 bottom-3 card bg-panel/90 backdrop-blur px-3 py-2 flex items-center gap-3">
            <button onClick={() => setPlaying((p) => !p)} className="pill bg-brand text-white shrink-0 flex items-center gap-1.5" aria-label={playing ? "Pause" : "Play"}>
              {playing ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l11-7z" /></svg>
              )}
              {playing ? "Pause" : "Play"}
            </button>
            <input
              type="range"
              min={tRange[0]}
              max={tRange[1]}
              value={Math.min(Math.max(t, tRange[0]), tRange[1])}
              step={Math.max(1000, Math.round((tRange[1] - tRange[0]) / 1000))}
              onChange={(e) => { setPlaying(false); setT(+e.target.value); }}
              className="flex-1 accent-brand"
            />
            <span className="text-xs text-sub shrink-0 tabular-nums">{t ? fmtDateTime(t) : "—"}</span>
          </div>
        )}
      </div>
      <div className="text-[11px] text-sub mt-2">Last update {fmtDateTime(s.updated)}</div>

      {/* Repo details (the repo.json entry) shown when a repo marker is clicked */}
      <Drawer open={!!repoSel} onClose={() => setRepoSel(null)} title={repoSel ? <span className="font-mono text-xs">{repoSel.host}</span> : ""}>
        {repoSel && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Flag cc={repoSel.geo?.cc} />
              <span className="text-sm">{repoSel.geo?.country || repoSel.country || "—"}{repoSel.geo?.region ? ` · ${repoSel.geo.region}` : ""}{repoSel.geo?.city ? ` · ${repoSel.geo.city}` : ""}</span>
            </div>
            <div className="card divide-y divide-line/60">
              <Row k="Host" v={<span className="font-mono text-xs">{repoSel.host || "—"}</span>} />
              <Row k="Repo name" v={repoSel.repo_name || "—"} />
              <Row k="Connections" v={nf(repoSel.count)} />
              <Row k="Last seen" v={fmtDateTime(repoSel.last_seen)} />
              <Row k="Sample URL" v={repoSel.sample_url ? <a href={repoSel.sample_url} target="_blank" rel="noreferrer" className="text-brand text-xs break-all">{repoSel.sample_url}</a> : "—"} />
            </div>
            {repoSel.sample_url && /^https?:/i.test(repoSel.sample_url) && (
              <a href={repoSel.sample_url.replace(/\/?$/, "/repo.json")} target="_blank" rel="noreferrer" className="inline-block text-sm text-brand">Open repo.json →</a>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 text-sm">
      <span className="text-sub">{k}</span>
      <span className="text-right max-w-[65%] truncate">{v}</span>
    </div>
  );
}
