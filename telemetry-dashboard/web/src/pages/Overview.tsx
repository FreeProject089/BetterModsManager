import { useState } from "react";
import { Link } from "react-router-dom";
import { useStats } from "../lib/store";
import { Card, StatusDot, Empty } from "../components/ui";
import { Chart, axisX, axisY } from "../components/Chart";
import { ProfileAvatar, Flag, ArrowIcon } from "../components/visuals";
import { nf, ago } from "../lib/format";

function Spark({ data, color = "#5b8cff" }: { data: number[]; color?: string }) {
  if (!data.length) return <div className="h-8" />;
  const w = 120, h = 32;
  const max = Math.max(1, ...data), min = Math.min(...data), rng = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1 || 1)) * w},${h - ((v - min) / rng) * (h - 4) - 2}`).join(" ");
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="mt-1">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Bars({ rows }: { rows: { label: string; cc?: string; value: number }[] }) {
  if (!rows.length) return <Empty>No data.</Empty>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-1">
      {rows.slice(0, 8).map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-sm py-0.5">
          <span className="w-36 truncate flex items-center gap-1.5">{r.cc ? <Flag cc={r.cc} /> : null} {r.label || "—"}</span>
          <div className="flex-1 h-2 rounded bg-panel2 overflow-hidden">
            <div className="h-full bg-brand" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <span className="w-10 text-right text-sub">{nf(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

function KpiSpark({ label, value, data, color }: { label: string; value: React.ReactNode; data: number[]; color?: string }) {
  return (
    <div className="kpi">
      <div className="text-[11px] uppercase tracking-wide text-sub">{label}</div>
      <div className="text-2xl font-semibold mt-0.5">{value}</div>
      <Spark data={data} color={color} />
    </div>
  );
}

const GRAN: { key: string; label: string }[] = [
  { key: "15m", label: "15 min" },
  { key: "30m", label: "30 min" },
  { key: "1h", label: "1 h" },
  { key: "1d", label: "24 h" },
];

// Series the overview chart can plot (each maps to a bucket field).
const METRICS: { key: string; label: string; color: string }[] = [
  { key: "users", label: "Users", color: "#5b8cff" },
  { key: "pageviews", label: "Pageviews", color: "#37d399" },
  { key: "sessions", label: "Sessions", color: "#a78bfa" },
  { key: "events", label: "Events", color: "#f4b740" },
];

export default function Overview() {
  const s = useStats()!;
  const t = s.totals;
  const [gran, setGran] = useState("1h");
  const [active, setActive] = useState<Set<string>>(new Set(["users", "pageviews"]));
  const toggle = (k: string) => setActive((a) => {
    const n = new Set(a);
    n.has(k) ? n.delete(k) : n.add(k);
    if (n.size === 0) n.add(k); // never empty
    return n;
  });

  const sUsers = s.series.map((r: any) => r.users);
  const sSessions = s.series.map((r: any) => r.sessions);
  const sPv = s.series.map((r: any) => r.pageviews);
  const sEvents = s.series.map((r: any) => r.events);

  const src: any[] = (s as any).buckets?.[gran] || s.series.map((r: any) => ({ ...r, t: (r.hour || "").slice(11) + "h" }));
  const interval = gran === "15m" ? 7 : gran === "30m" ? 3 : 0;
  const shown = METRICS.filter((m) => active.has(m.key));
  const mainOpt = {
    grid: { left: 40, right: 16, top: 24, bottom: 24 },
    legend: { data: shown.map((m) => m.label), textStyle: { color: "#9aa3ad" }, right: 10, top: 0 },
    xAxis: { ...axisX(src.map((r) => r.t)), axisLabel: { color: "#9aa3ad", fontSize: 10, interval } },
    yAxis: axisY(),
    series: shown.map((m, i) => ({
      name: m.label,
      type: "line",
      smooth: true,
      showSymbol: false,
      data: src.map((r) => r[m.key] ?? 0),
      lineStyle: { color: m.color, width: 2 },
      ...(i === 0 ? { areaStyle: { color: m.color + "2e" } } : {}),
    })),
  };

  const hod: any[] = (s as any).hour_of_day || [];
  const hodOpt = {
    grid: { left: 40, right: 16, top: 16, bottom: 24 },
    tooltip: { trigger: "axis", formatter: (p: any) => `${p[0].axisValue}<br/>${nf(p[0].data)} sessions` },
    xAxis: { ...axisX(hod.map((h) => String(h.hour).padStart(2, "0") + "h")), axisLabel: { color: "#9aa3ad", fontSize: 10, interval: 1 } },
    yAxis: axisY(),
    series: [{ type: "bar", data: hod.map((h) => h.sessions), itemStyle: { color: "#5b8cff", borderRadius: [3, 3, 0, 0] }, barWidth: "62%" }],
  };

  const paths = (s.funnels || []).slice(0, 8);
  const pathOpt = {
    grid: { left: 150, right: 24, top: 6, bottom: 6 },
    xAxis: axisY({ axisLabel: { show: false }, splitLine: { show: false } }),
    yAxis: { ...axisX(paths.map((p: any) => p.path).reverse()), axisLabel: { color: "#e8eaed", fontSize: 11 } },
    series: [{ type: "bar", data: paths.map((p: any) => p.count).reverse(), itemStyle: { color: "#5b8cff", borderRadius: [0, 4, 4, 0] }, barWidth: 14 }],
    tooltip: { trigger: "item" },
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <KpiSpark label="Users" value={nf(t.users)} data={sUsers} />
        <KpiSpark label="Live now" value={nf(t.live)} data={sUsers} color="#37d399" />
        <KpiSpark label="Sessions" value={nf(t.sessions)} data={sSessions} color="#a78bfa" />
        <KpiSpark label="Pageviews" value={nf(t.pageviews)} data={sPv} color="#37d399" />
        <KpiSpark label="Events" value={nf(t.events)} data={sEvents} color="#f4b740" />
        <KpiSpark label="Pages / session" value={t.pages_per_session} data={sPv} />
        <KpiSpark label="Avg session" value={`${t.avg_session_min}m`} data={sSessions} color="#a78bfa" />
        <KpiSpark label="Events / session" value={(t as any).avg_events_per_session ?? "—"} data={sEvents} color="#f4b740" />
        <KpiSpark label="Sessions / user" value={(t as any).avg_sessions_per_user ?? "—"} data={sSessions} color="#a78bfa" />
      </div>

      <Card
        title="Activity"
        right={
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex gap-1">
              {METRICS.map((m) => (
                <button key={m.key} onClick={() => toggle(m.key)} className="pill border border-line" style={active.has(m.key) ? { background: m.color, color: "#0b0d10" } : { color: "#9aa3ad" }}>{m.label}</button>
              ))}
            </div>
            <span className="w-px h-4 bg-line" />
            <div className="flex gap-1">
              {GRAN.map((g) => (
                <button key={g.key} onClick={() => setGran(g.key)} className={`pill ${gran === g.key ? "bg-brand text-white" : "bg-panel2 text-sub"}`}>{g.label}</button>
              ))}
            </div>
          </div>
        }
      >
        <Chart option={mainOpt} height={300} />
      </Card>

      <Card
        title="Quand les utilisateurs utilisent BMM"
        right={<span className="text-xs text-sub">Heure de pointe : <span className="text-brand font-medium">{String((s as any).peak_hour ?? 0).padStart(2, "0")}h UTC</span></span>}
      >
        <Chart option={hodOpt} height={220} />
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Live instances" right={<Link to="/live" className="text-xs text-brand">View all</Link>}>
          {s.live.length ? (
            <div className="space-y-1">
              {s.live.slice(0, 6).map((l) => (
                <Link to="/live" key={l.creator_id} className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-panel2 text-sm">
                  <StatusDot status={l.status} />
                  <ProfileAvatar name={l.creator_id} size={22} />
                  <Flag cc={l.cc} />
                  <span className="font-mono text-xs truncate flex-1">{l.creator_id}</span>
                  <span className="text-sub">{l.view || "—"}</span>
                  <span className="text-sub text-xs">{ago(l.ago_s)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <Empty>No live instances</Empty>
          )}
        </Card>
        <Card title="Top paths" right={<Link to="/funnels" className="text-xs text-brand">Funnels</Link>}>
          {paths.length ? <Chart option={pathOpt} height={220} /> : <Empty>No navigation paths yet</Empty>}
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="Users by country" right={<Link to="/map" className="text-xs text-brand">Map</Link>}>
          <Bars rows={(s.geo || []).map((g: any) => ({ label: g.country, cc: s.country_cc?.[g.country], value: g.count }))} />
        </Card>
        <Card title="Operating systems">
          <Bars rows={(s.os || []).map((o: any) => ({ label: o.k, value: o.v }))} />
        </Card>
        <Card title="GPU vendors">
          <Bars rows={(s.gpu || []).map((g: any) => ({ label: g.k, value: g.v }))} />
        </Card>
      </div>

      <Card title="Top pages" right={<Link to="/pages" className="text-xs text-brand">Details</Link>}>
        <table className="w-full">
          <tbody>
            {s.pages.slice(0, 10).map((p) => (
              <tr key={p.view} className="hover:bg-panel2">
                <td className="td border-0 py-1.5 flex items-center gap-2">
                  <ArrowIcon className="text-sub" /> {p.view}
                </td>
                <td className="td border-0 py-1.5 text-right text-sub">{Math.round((p.avg_dwell_ms || 0) / 1000)}s dwell</td>
                <td className="td border-0 py-1.5 text-right font-medium">{nf(p.enters)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
