import { useState } from "react";
import { useStats } from "../lib/store";
import { Card, Kpi, Empty, Drawer } from "../components/ui";
import { Chart, axisX, axisY } from "../components/Chart";
import { Flag } from "../components/visuals";
import { nf, vitalClass, fmtVital } from "../lib/format";
import type { PageRow } from "../lib/types";

// thresholds in MS (CLS unitless) — matches what the client sends.
const METRICS: { key: string; label: string; good: number; poor: number }[] = [
  { key: "lcp", label: "LCP", good: 2500, poor: 4000 },
  { key: "fcp", label: "FCP", good: 1800, poor: 3000 },
  { key: "inp", label: "INP", good: 200, poor: 500 },
  { key: "cls", label: "CLS", good: 0.1, poor: 0.25 },
  { key: "ttfb", label: "TTFB", good: 800, poor: 1800 },
];
const PCTS = ["p50", "p75", "p90", "p99"] as const;
const TABS = ["Pages", "Countries", "Operating systems", "GPU"] as const;

export default function Pages() {
  const s = useStats()!;
  const wv = s.webvitals || {};
  const wvp = (s as any).webvitals_pct || {};
  const [metric, setMetric] = useState("lcp");
  const [pct, setPct] = useState<(typeof PCTS)[number]>("p90");
  const [tab, setTab] = useState<(typeof TABS)[number]>("Pages");
  const [sel, setSel] = useState<PageRow | null>(null);
  const m = METRICS.find((x) => x.key === metric)!;
  const series = s.webvitals_series || [];
  const kpi = (key: string) => (wvp[key] && wvp[key][pct] != null ? wvp[key][pct] : wv[key]);

  const graph = {
    grid: { left: 52, right: 70, top: 16, bottom: 26 },
    xAxis: axisX(series.map((r: any) => (r.hour || "").slice(11) + "h")),
    yAxis: axisY(),
    series: [
      {
        type: "line",
        smooth: true,
        showSymbol: false,
        data: series.map((r: any) => r[metric]),
        lineStyle: { color: "#5b8cff", width: 2 },
        areaStyle: { color: "rgba(91,140,255,0.12)" },
        markLine: {
          silent: true,
          symbol: "none",
          label: { fontSize: 10 },
          data: [
            { yAxis: m.good, lineStyle: { color: "#37d399", type: "dashed" }, label: { formatter: `Good ≤ ${fmtVital(metric, m.good)}`, color: "#37d399", position: "end" } },
            { yAxis: m.poor, lineStyle: { color: "#f4b740", type: "dashed" }, label: { formatter: `Needs ≤ ${fmtVital(metric, m.poor)}`, color: "#f4b740", position: "end" } },
          ],
        },
      },
    ],
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold">Web Vitals</h2>
        <div className="flex gap-1">
          {PCTS.map((p) => (
            <button key={p} onClick={() => setPct(p)} className={`pill ${pct === p ? "bg-brand text-white" : "bg-panel2 text-sub"}`}>{p.toUpperCase()}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {METRICS.map((x) => (
          <Kpi key={x.key} label={x.label} value={<span className={vitalClass(x.key, kpi(x.key))}>{fmtVital(x.key, kpi(x.key))}</span>} />
        ))}
        <Kpi label="Samples" value={nf(wv.n)} />
      </div>

      <Card
        title={`${m.label} · last 24h`}
        right={
          <div className="flex gap-1">
            {METRICS.map((x) => (
              <button key={x.key} onClick={() => setMetric(x.key)} className={`pill ${metric === x.key ? "bg-brand text-white" : "bg-panel2 text-sub"}`}>{x.label}</button>
            ))}
          </div>
        }
      >
        {series.length ? <Chart option={graph} height={300} /> : <Empty>No web-vitals samples yet. They arrive once per app launch.</Empty>}
      </Card>

      {s.perf && (
        <>
          <h2 className="text-lg font-semibold pt-1">App performance</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Kpi label="FPS (avg)" value={s.perf.fps_avg ?? "—"} />
            <Kpi label="Frame time" value={`${s.perf.frametime_avg_ms ?? "—"} ms`} />
            <Kpi label="Worst frame (jank)" value={`${s.perf.frametime_worst_ms ?? "—"} ms`} />
            <Kpi label="JS heap" value={`${s.perf.heap_avg_mb ?? "—"} MB`} />
            <Kpi label="Benchmark" value={`${s.perf.bench_mbps_avg ?? "—"} MB/s`} />
          </div>
          <Card title="Per view — rendering" right={<span className="text-xs text-sub">FPS / frame time / jank / heap</span>}>
            {(s.perf.byView || []).length ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="th">View</th>
                      <th className="th text-right">FPS</th>
                      <th className="th text-right">Frame ms</th>
                      <th className="th text-right">Worst (jank)</th>
                      <th className="th text-right">Heap MB</th>
                      <th className="th text-right">Samples</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(s.perf.byView || []).map((v: any) => (
                      <tr key={v.view} className="hover:bg-panel2">
                        <td className="td">{v.view}</td>
                        <td className={`td text-right ${v.fps < 30 ? "text-bad" : v.fps < 50 ? "text-warn" : "text-good"}`}>{v.fps}</td>
                        <td className="td text-right">{v.ft}</td>
                        <td className={`td text-right ${v.worst > 100 ? "text-bad" : v.worst > 50 ? "text-warn" : "text-sub"}`}>{v.worst}</td>
                        <td className="td text-right text-sub">{v.heap}</td>
                        <td className="td text-right text-sub">{v.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>No performance samples yet.</Empty>
            )}
          </Card>
        </>
      )}

      <Card
        title="Breakdown"
        right={
          <div className="flex gap-1">
            {TABS.map((x) => (
              <button key={x} onClick={() => setTab(x)} className={`pill ${tab === x ? "bg-brand text-white" : "bg-panel2 text-sub"}`}>{x}</button>
            ))}
          </div>
        }
      >
        {tab === "Pages" ? (
          s.pages.length ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="th">Page</th>
                    <th className="th text-right">Views</th>
                    <th className="th text-right">Dwell</th>
                    <th className="th text-right">LCP</th>
                    <th className="th text-right">CLS</th>
                    <th className="th text-right">INP</th>
                    <th className="th text-right">FCP</th>
                    <th className="th text-right">TTFB</th>
                    <th className="th text-right">FPS</th>
                    <th className="th text-right">Events</th>
                  </tr>
                </thead>
                <tbody>
                  {s.pages.map((p) => (
                    <tr key={p.view} onClick={() => setSel(p)} className="cursor-pointer hover:bg-panel2">
                      <td className="td">{p.view}</td>
                      <td className="td text-right">{nf(p.enters)}</td>
                      <td className="td text-right text-sub">{Math.round((p.avg_dwell_ms || 0) / 1000)}s</td>
                      <td className={`td text-right ${vitalClass("lcp", p.lcp)}`}>{fmtVital("lcp", p.lcp)}</td>
                      <td className={`td text-right ${vitalClass("cls", p.cls)}`}>{fmtVital("cls", p.cls)}</td>
                      <td className={`td text-right ${vitalClass("inp", p.inp)}`}>{fmtVital("inp", p.inp)}</td>
                      <td className={`td text-right ${vitalClass("fcp", p.fcp)}`}>{fmtVital("fcp", p.fcp)}</td>
                      <td className={`td text-right ${vitalClass("ttfb", p.ttfb)}`}>{fmtVital("ttfb", p.ttfb)}</td>
                      <td className="td text-right text-sub">{p.fps ?? "—"}</td>
                      <td className="td text-right">{nf(p.events || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No pageviews recorded yet.</Empty>
          )
        ) : (
          <BreakdownList
            rows={
              tab === "Countries"
                ? (s.geo || []).map((g: any) => ({ label: g.country, cc: s.country_cc?.[g.country], value: g.count }))
                : tab === "Operating systems"
                ? (s.os || []).map((o: any) => ({ label: o.k, value: o.v }))
                : (s.gpu || []).map((g: any) => ({ label: g.k, value: g.v }))
            }
          />
        )}
      </Card>

      <Drawer open={!!sel} onClose={() => setSel(null)} title={sel?.view || ""}>
        {sel && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Kpi label="Views" value={nf(sel.enters)} />
              <Kpi label="Avg dwell" value={`${Math.round((sel.avg_dwell_ms || 0) / 1000)}s`} />
              <Kpi label="Events" value={nf(sel.events || 0)} />
            </div>
            <Card title="Web vitals (this page)">
              <div className="grid grid-cols-2 gap-2 text-sm">
                {METRICS.map((x) => (
                  <div key={x.key} className="flex items-center justify-between px-1 py-1">
                    <span className="text-sub">{x.label}</span>
                    <span className={vitalClass(x.key, (sel as any)[x.key])}>{fmtVital(x.key, (sel as any)[x.key])}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Rendering">
              <div className="flex items-center justify-between text-sm px-1 py-1">
                <span className="text-sub">FPS (avg)</span>
                <span>{sel.fps ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between text-sm px-1 py-1">
                <span className="text-sub">Frame time</span>
                <span>{sel.ft != null ? `${sel.ft} ms` : "—"}</span>
              </div>
            </Card>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function BreakdownList({ rows }: { rows: { label: string; cc?: string; value: number }[] }) {
  if (!rows.length) return <Empty>No data.</Empty>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3 text-sm py-1">
          <span className="w-48 truncate flex items-center gap-2">{r.cc ? <Flag cc={r.cc} /> : null} {r.label}</span>
          <div className="flex-1 h-2 rounded bg-panel2 overflow-hidden">
            <div className="h-full bg-brand" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <span className="w-12 text-right">{nf(r.value)}</span>
        </div>
      ))}
    </div>
  );
}
