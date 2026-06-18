import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { createRoot, type Root } from "react-dom/client";
import { useStats, apiGet } from "../lib/store";
import { ProfileAvatar, Flag } from "../components/visuals";
import { fmtDateTime, dur } from "../lib/format";

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

const ADMIN1_URL = "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_1_states_provinces.geojson";

type Tab = "points" | "pays" | "subdivisions";

export default function MapPage() {
  const s = useStats()!;
  const [mode, setMode] = useState<"2d" | "globe">("globe");
  const [tab, setTab] = useState<Tab>("points");
  const [sessions, setSessions] = useState<any[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<{ m: maplibregl.Marker; root: Root }[]>([]);
  const admin1Loaded = useRef(false);

  const users = s.map?.users || [];
  const repos = s.map?.repos || [];
  const total = users.length + repos.length;
  const maxC = Math.max(1, ...(s.geo || []).map((g: any) => g.count));

  const ccOf = (id: string) => s.users.find((u) => u.creator_id === id)?.cc;

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
    const map = new maplibregl.Map({
      container: boxRef.current,
      style: STYLE,
      center: [10, 35],
      zoom: 1.4,
      attributionControl: false,
      maxPitch: 0,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.on("load", () => {
      map.setProjection({ type: mode === "globe" ? "globe" : "mercator" } as any);
      // country choropleth source (local, offline-safe)
      fetch("/world.json").then((r) => r.json()).then((geo) => {
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
      }).catch(() => {});
      rebuildMarkers();
    });
    return () => {
      markersRef.current.forEach((x) => { try { x.root.unmount(); } catch {} x.m.remove(); });
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // projection toggle
  useEffect(() => {
    const map = mapRef.current;
    if (map && map.isStyleLoaded()) {
      try { map.setProjection({ type: mode === "globe" ? "globe" : "mercator" } as any); } catch {}
    }
  }, [mode]);

  // avatar markers for located users (limited for performance)
  const rebuildMarkers = () => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((x) => { try { x.root.unmount(); } catch {} x.m.remove(); });
    markersRef.current = [];
    if (tab === "subdivisions") return; // markers off in the subdivisions choropleth view
    const pts = [
      ...users.map((u: any) => ({ ...u, kind: "user" })),
      ...repos.map((r: any) => ({ ...r, kind: "repo" })),
    ].slice(0, 200);
    for (const p of pts) {
      if (p.lon == null || p.lat == null) continue;
      const el = document.createElement("div");
      el.style.cursor = "pointer";
      const root = createRoot(el);
      root.render(
        <div className="rounded-full ring-2 ring-white/40 shadow" style={{ width: 30, height: 30, overflow: "hidden", background: p.kind === "repo" ? "#a78bfa" : "#13161b" }}>
          {p.kind === "user" ? <ProfileAvatar name={`${p.country}-${p.count}-${p.lat}`} size={30} /> : null}
        </div>
      );
      const m = new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat])
        .setPopup(new maplibregl.Popup({ offset: 18, closeButton: false }).setHTML(`<div style="font:12px Inter,sans-serif">${p.country || p.host || ""} · ${p.count} ${p.kind === "repo" ? "repo" : "user(s)"}</div>`))
        .addTo(map);
      markersRef.current.push({ m, root });
    }
  };

  // choropleth (Pays = countries by user count; Subdivisions = admin-1 with users)
  const applyChoropleth = () => {
    const map = mapRef.current;
    if (!map || !map.getLayer("country-fill")) return;
    if (tab === "pays") {
      const expr: any[] = ["match", ["get", "name"]];
      for (const g of s.geo || []) {
        const a = Math.max(0.15, Math.min(0.85, g.count / maxC));
        expr.push(g.country, `rgba(55,211,153,${a})`);
      }
      expr.push("rgba(255,255,255,0.02)");
      map.setPaintProperty("country-fill", "fill-color", expr as any);
      map.setLayoutProperty("country-fill", "visibility", "visible");
    } else if (tab === "subdivisions") {
      map.setLayoutProperty("country-fill", "visibility", "none");
      ensureSubdivisions();
    } else {
      map.setLayoutProperty("country-fill", "visibility", "none");
    }
  };

  // lazily fetch admin-1 regions for the subdivisions view (large → on demand)
  const ensureSubdivisions = () => {
    const map = mapRef.current;
    if (!map) return;
    const regionNames = new Set((s.regions || []).map((r: any) => String(r.region).split("·").pop()!.trim()));
    const paint = (): any => {
      const expr: any[] = ["match", ["get", "name"]];
      let any = false;
      regionNames.forEach((n) => { if (n) { expr.push(n, "rgba(55,211,153,0.6)"); any = true; } });
      expr.push("rgba(255,255,255,0.03)");
      return any ? expr : "rgba(255,255,255,0.03)";
    };
    if (admin1Loaded.current) {
      if (map.getLayer("admin1-fill")) {
        map.setPaintProperty("admin1-fill", "fill-color", paint());
        map.setLayoutProperty("admin1-fill", "visibility", "visible");
      }
      return;
    }
    fetch(ADMIN1_URL).then((r) => r.json()).then((geo) => {
      admin1Loaded.current = true;
      if (!map.getSource("admin1")) map.addSource("admin1", { type: "geojson", data: geo });
      if (!map.getLayer("admin1-fill")) {
        map.addLayer({ id: "admin1-fill", type: "fill", source: "admin1", paint: { "fill-color": paint(), "fill-outline-color": "rgba(255,255,255,0.12)" } });
      }
    }).catch(() => {});
  };

  // re-apply when data/tab change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    rebuildMarkers();
    applyChoropleth();
    if (map.getLayer("admin1-fill") && tab !== "subdivisions") map.setLayoutProperty("admin1-fill", "visibility", "none");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, s.updated]);

  const TABS: { k: Tab; label: string }[] = useMemo(() => [
    { k: "points", label: "Coordonnées" },
    { k: "pays", label: "Pays" },
    { k: "subdivisions", label: "Subdivisions" },
  ], []);

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Geography</h2>
          <span className="text-xs text-sub">approximate only — never precise · {users.length} users · {repos.length} repos</span>
        </div>
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button key={t.k} onClick={() => setTab(t.k)} className={`pill ${tab === t.k ? "bg-brand text-white" : "bg-panel2 text-sub"}`}>{t.label}</button>
          ))}
          <span className="w-px bg-line mx-1" />
          <button onClick={() => setMode("2d")} className={`pill ${mode === "2d" ? "bg-brand text-white" : "bg-panel2 text-sub"}`}>2D</button>
          <button onClick={() => setMode("globe")} className={`pill ${mode === "globe" ? "bg-brand text-white" : "bg-panel2 text-sub"}`}>3D globe</button>
        </div>
      </div>

      <div className="relative card overflow-hidden" style={{ height: 620 }}>
        <div ref={boxRef} style={{ position: "absolute", inset: 0 }} />
        {total === 0 && (
          <div className="absolute inset-x-0 bottom-3 text-center text-xs text-sub pointer-events-none">
            No located users yet — locations resolve server-side from each client's IP once users opt in.
          </div>
        )}
        {/* live sessions panel */}
        <div className="absolute right-3 bottom-3 w-72 max-h-[55%] overflow-y-auto card bg-panel/90 backdrop-blur p-2">
          <div className="text-[11px] uppercase tracking-wide text-sub px-1 pb-1">Sessions</div>
          {sessions.length ? sessions.slice(0, 8).map((r) => (
            <Link to={`/users/${encodeURIComponent(r.distinct_id)}`} key={r.session_id} className="flex items-center gap-2 px-1 py-1.5 rounded-lg hover:bg-panel2 text-xs">
              <ProfileAvatar name={r.distinct_id} size={20} />
              <Flag cc={ccOf(r.distinct_id)} />
              <span className="truncate flex-1">{r.entry || "—"} → {r.exit || "—"}</span>
              <span className="text-sub">{dur(r.duration_s)}</span>
            </Link>
          )) : <div className="text-xs text-sub px-1 py-2">No sessions.</div>}
        </div>
      </div>
      <div className="text-[11px] text-sub mt-2">Last update {fmtDateTime(s.updated)}</div>
    </div>
  );
}
