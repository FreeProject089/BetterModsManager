import { useEffect, useState } from "react";
import * as echarts from "echarts";
import { useStats } from "../lib/store";
import { Card, Empty } from "../components/ui";
import { Chart } from "../components/Chart";

let worldReady = false;

export default function MapPage() {
  const s = useStats()!;
  const [mode, setMode] = useState<"2d" | "globe">("2d");
  const [ready, setReady] = useState(worldReady);
  const [glReady, setGlReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // register the locally-bundled world map once (no CDN → works offline)
  useEffect(() => {
    if (worldReady) {
      setReady(true);
      return;
    }
    fetch("/world.json")
      .then((r) => r.json())
      .then((geo) => {
        echarts.registerMap("world", geo as any);
        worldReady = true;
        setReady(true);
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    if (mode !== "globe" || glReady) return;
    import("echarts-gl").then(() => setGlReady(true)).catch(() => setFailed(true));
  }, [mode, glReady]);

  const users = s.map?.users || [];
  const repos = s.map?.repos || [];
  const userData = users.map((u: any) => ({ value: [u.lon, u.lat, u.count], name: `${u.country || ""} · ${u.count} user(s)` }));
  const repoData = repos.map((r: any) => ({ value: [r.lon, r.lat, r.count], name: `${r.host || r.country || ""}` }));
  const countryData = (s.geo || []).map((g: any) => ({ name: g.country, value: g.count }));
  const maxC = Math.max(1, ...countryData.map((c: any) => c.value));
  const total = users.length + repos.length;

  // 2D: choropleth (users per country) + overlaid user/repo points.
  const map2d: any = {
    tooltip: { trigger: "item", formatter: (p: any) => (p.seriesType === "map" ? `${p.name}: ${p.value || 0}` : p.name) },
    visualMap: {
      min: 0,
      max: maxC,
      left: 12,
      bottom: 12,
      calculable: true,
      inRange: { color: ["#161b22", "#1e3a5f", "#2f5fae", "#5b8cff"] },
      textStyle: { color: "#9aa3ad" },
    },
    geo: { map: "world", roam: true, silent: true, show: false, itemStyle: { areaColor: "#161b22", borderColor: "#2a313b" } },
    series: [
      {
        type: "map",
        map: "world",
        roam: true,
        data: countryData,
        itemStyle: { areaColor: "#161b22", borderColor: "#2a313b", borderWidth: 0.5 },
        emphasis: { itemStyle: { areaColor: "#22304a" }, label: { show: false } },
        select: { itemStyle: { areaColor: "#2f5fae" } },
      },
      { name: "Users", type: "effectScatter", coordinateSystem: "geo", geoIndex: 0, data: userData, symbolSize: (v: any) => 6 + Math.min(20, v[2] * 3), itemStyle: { color: "#37d399" }, rippleEffect: { scale: 2.5 }, zlevel: 2 },
      { name: "Repos", type: "scatter", coordinateSystem: "geo", geoIndex: 0, data: repoData, symbolSize: (v: any) => 5 + Math.min(16, v[2] * 2), itemStyle: { color: "#a78bfa" }, zlevel: 3 },
    ],
  };

  // 3D textured globe (echarts-gl) + scatter3D points.
  const globe: any = {
    backgroundColor: "transparent",
    globe: {
      baseTexture: "/earth-dark.jpg",
      heightTexture: "/earth-topology.png",
      displacementScale: 0.05,
      shading: "realistic",
      environment: "#0b0d10",
      realisticMaterial: { roughness: 0.85, metalness: 0 },
      postEffect: { enable: true, SSAO: { enable: true, radius: 2 } },
      light: { main: { intensity: 2, shadow: false }, ambient: { intensity: 0.25 } },
      viewControl: { autoRotate: true, autoRotateSpeed: 8, distance: 180 },
    },
    series: [
      { type: "scatter3D", coordinateSystem: "globe", data: userData, symbolSize: (v: any) => 6 + Math.min(18, v[2] * 3), itemStyle: { color: "#37d399", opacity: 0.95 }, label: { show: false } },
      { type: "scatter3D", coordinateSystem: "globe", data: repoData, symbolSize: 7, itemStyle: { color: "#a78bfa" } },
    ],
  };

  return (
    <Card
      title="Geography"
      right={
        <div className="flex items-center gap-3">
          <span className="text-xs text-sub">approximate only — never precise</span>
          <div className="flex gap-1">
            <button onClick={() => setMode("2d")} className={`pill ${mode === "2d" ? "bg-brand text-white" : "bg-panel2 text-sub"}`}>2D map</button>
            <button onClick={() => setMode("globe")} className={`pill ${mode === "globe" ? "bg-brand text-white" : "bg-panel2 text-sub"}`}>3D globe</button>
          </div>
        </div>
      }
    >
      <div className="flex items-center gap-4 mb-3 text-xs text-sub">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-good inline-block" /> Users ({users.length})</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: "#a78bfa" }} /> Repo hosts ({repos.length})</span>
      </div>

      {failed ? (
        <Empty>Map assets failed to load.</Empty>
      ) : total === 0 ? (
        <Empty>No located users yet. Locations resolve from IP once users opt in and connect.</Empty>
      ) : mode === "2d" ? (
        ready ? <Chart option={map2d} height={560} /> : <Empty>Loading world map…</Empty>
      ) : glReady ? (
        <Chart option={globe} height={560} />
      ) : (
        <Empty>Loading 3D globe…</Empty>
      )}
    </Card>
  );
}
