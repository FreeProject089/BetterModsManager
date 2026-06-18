import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useStats } from "../lib/store";
import { Card, Empty, Drawer } from "../components/ui";
import { Chart, axisX, axisY } from "../components/Chart";
import { fmtDateTime, nf } from "../lib/format";

// per-op map helper: ops may be {id: ms} — normalize to entries
function opEntries(ops: any): [string, number][] {
  if (!ops || typeof ops !== "object") return [];
  return Object.entries(ops).filter(([, v]) => typeof v === "number") as [string, number][];
}

function DeltaBadge({ a, b }: { a: any; b: any }) {
  // a = previous, b = latest. Negative ms delta = faster (good).
  if (a?.total_ms == null || b?.total_ms == null) return null;
  const d = b.total_ms - a.total_ms;
  const pct = a.total_ms ? Math.round((d / a.total_ms) * 1000) / 10 : 0;
  const faster = d < 0;
  return (
    <span className={`pill ${faster ? "bg-good/20 text-good" : d > 0 ? "bg-bad/20 text-bad" : "bg-panel2 text-sub"}`}>
      {Math.abs(pct)}% {faster ? "faster" : d > 0 ? "slower" : "same"}
    </span>
  );
}

function Donut({ title, rows }: { title: string; rows: { k: string; v: number }[] }) {
  const opt = {
    tooltip: { trigger: "item" },
    legend: { show: false },
    series: [
      {
        type: "pie",
        radius: ["55%", "78%"],
        center: ["50%", "50%"],
        avoidLabelOverlap: true,
        label: { color: "#9aa3ad", fontSize: 11 },
        data: rows.map((r) => ({ name: r.k, value: r.v })),
        itemStyle: { borderColor: "#13161b", borderWidth: 2 },
      },
    ],
    color: ["#5b8cff", "#37d399", "#f4b740", "#f06363", "#a78bfa", "#22d3ee"],
  };
  return <Card title={title}>{rows.length ? <Chart option={opt} height={220} /> : <Empty>No data.</Empty>}</Card>;
}

export default function Bmm() {
  const s = useStats()!;
  const [bench, setBench] = useState<any | null>(null);

  // group the (≤2 per creator) recent benchmarks by creator for comparison
  const benchByCreator = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const b of s.benchmarks_recent || []) (m[b.creator_id] || (m[b.creator_id] = [])).push(b);
    return Object.entries(m);
  }, [s.benchmarks_recent]);

  const opsOpt = {
    grid: { left: 130, right: 30, top: 6, bottom: 20 },
    xAxis: axisY(),
    yAxis: { ...axisX((s.benchmarks_ops || []).map((o: any) => o.op).reverse()), axisLabel: { color: "#e8eaed", fontSize: 11 } },
    series: [{ type: "bar", data: (s.benchmarks_ops || []).map((o: any) => o.avg_ms).reverse(), itemStyle: { color: "#5b8cff", borderRadius: [0, 4, 4, 0] }, label: { show: true, position: "right", color: "#9aa3ad", formatter: "{c} ms" } }],
    tooltip: { trigger: "item" },
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Donut title="Themes (kind)" rows={s.theme_kind} />
        <Donut title="Languages" rows={s.languages} />
        <Donut title="GPU vendors" rows={s.gpu} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card title="Tasky">
          <div className="space-y-1 text-sm">
            <Row k="Visible" v={s.tasky?.visible} />
            <Row k="Hidden" v={s.tasky?.hidden} />
            <Row k="Animations" v={s.tasky?.animations} />
            <Row k="Tooltips" v={s.tasky?.tooltips} />
          </div>
        </Card>
        <Card title="Top themes">
          <List rows={s.themes} />
        </Card>
        <Card title="Operating systems">
          <List rows={s.os} />
        </Card>
        <Card title="VMs detected">
          <div className="text-3xl font-semibold mt-2">{nf(s.vm_count)}</div>
        </Card>
      </div>

      {(s as any).content?.length > 0 && (
        <Card title="BMM content (across all users)">
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
            {(s as any).content.map((c: any) => (
              <div key={c.key} className="card px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-sub">{c.key.replace(/_/g, " ")}</div>
                <div className="text-xl font-semibold">{nf(c.total)}</div>
                <div className="text-[11px] text-sub">avg {c.avg} · {c.users} users</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Modals — usage & perf">
          {(s as any).modals_detail?.length ? (
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Modal</th>
                  <th className="th text-right">Opens</th>
                  <th className="th text-right">FPS</th>
                  <th className="th text-right">Frame ms</th>
                </tr>
              </thead>
              <tbody>
                {(s as any).modals_detail.map((m: any) => (
                  <tr key={m.name} className="hover:bg-panel2">
                    <td className="td font-mono text-xs">{m.name}</td>
                    <td className="td text-right">{nf(m.opens)}</td>
                    <td className="td text-right text-sub">{m.fps ?? "—"}</td>
                    <td className="td text-right text-sub">{m.ft ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>No modal activity yet.</Empty>
          )}
        </Card>
        <Card title="Filesystem access mode">
          <List rows={(s as any).access || []} />
        </Card>
      </div>

      <Card title="Benchmark — per-operation average">
        {s.benchmarks_ops?.length ? <Chart option={opsOpt} height={Math.max(180, s.benchmarks_ops.length * 28 + 40)} /> : <Empty>No benchmarks submitted yet.</Empty>}
      </Card>

      <Card title="Recent benchmarks" right={<span className="text-xs text-sub">2 latest runs per creator — click to compare</span>}>
        {benchByCreator.length ? (
          <div className="space-y-2">
            {benchByCreator.map(([cid, runs]) => (
              <div key={cid} className="card p-3">
                <div className="flex items-center justify-between mb-2">
                  <Link to={`/users/${encodeURIComponent(cid)}`} className="font-mono text-xs text-brand">{cid}</Link>
                  {runs.length === 2 && <DeltaBadge a={runs[1]} b={runs[0]} />}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {runs.map((b: any, i: number) => (
                    <button key={i} onClick={() => setBench(b)} className="text-left card px-3 py-2 hover:bg-panel2">
                      <div className="text-[11px] text-sub">{i === 0 ? "Latest" : "Previous"} · {b.source || "—"}</div>
                      <div className="text-lg font-semibold">{b.total_ms ? `${Math.round(b.total_ms)} ms` : "—"}</div>
                      <div className="text-[11px] text-sub">{b.throughput_mbps != null ? `${b.throughput_mbps} MB/s` : ""} · {fmtDateTime(b.ts)}</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty>No benchmarks.</Empty>
        )}
      </Card>

      <Card title={`Connected repositories · ${s.repos?.length || 0}`}>
        {s.repos?.length ? (
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Host</th>
                <th className="th">Country</th>
                <th className="th text-right">Connections</th>
              </tr>
            </thead>
            <tbody>
              {s.repos.map((r: any) => (
                <tr key={r.host}>
                  <td className="td font-mono text-xs">{r.host}</td>
                  <td className="td text-sub">{r.geo?.country || "—"}</td>
                  <td className="td text-right">{nf(r.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No public repo hosts.</Empty>
        )}
      </Card>

      <Drawer open={!!bench} onClose={() => setBench(null)} title="Benchmark — exact data">
        {bench && (
          <div className="space-y-3">
            <Link to={`/users/${encodeURIComponent(bench.creator_id)}`} className="font-mono text-xs text-brand">{bench.creator_id}</Link>
            <div className="grid grid-cols-2 gap-2">
              <Stat k="Total time" v={bench.total_ms != null ? `${Math.round(bench.total_ms)} ms` : "—"} />
              <Stat k="Throughput" v={bench.throughput_mbps != null ? `${bench.throughput_mbps} MB/s` : "—"} />
              <Stat k="Dataset" v={bench.dataset_bytes != null ? `${(bench.dataset_bytes / 1048576).toFixed(2)} MB` : "—"} />
              <Stat k="Source" v={bench.source || "—"} />
            </div>
            <div className="text-[11px] uppercase tracking-wide text-sub">Per-operation (exact)</div>
            <div className="card divide-y divide-line/60">
              {opEntries(bench.ops).length ? (
                opEntries(bench.ops).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="text-sub font-mono text-xs">{k}</span>
                    <span>{v.toFixed(2)} ms</span>
                  </div>
                ))
              ) : (
                <div className="px-3 py-2 text-sm text-sub">No per-op data.</div>
              )}
            </div>
            <div className="text-[11px] text-sub">{fmtDateTime(bench.ts)}</div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function Row({ k, v }: { k: string; v: any }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sub">{k}</span>
      <span className="font-medium">{nf(v || 0)}</span>
    </div>
  );
}
function Stat({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="card px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-sub">{k}</div>
      <div className="text-base font-semibold">{v}</div>
    </div>
  );
}
function List({ rows }: { rows: { k: string; v: number }[] }) {
  if (!rows?.length) return <Empty>No data.</Empty>;
  return (
    <div className="space-y-1 text-sm">
      {rows.slice(0, 8).map((r) => (
        <div key={r.k} className="flex items-center justify-between">
          <span className="truncate">{r.k}</span>
          <span className="text-sub">{nf(r.v)}</span>
        </div>
      ))}
    </div>
  );
}
