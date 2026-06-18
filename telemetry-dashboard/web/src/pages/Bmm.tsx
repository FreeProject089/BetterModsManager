import { useState } from "react";
import { Link } from "react-router-dom";
import { useStats } from "../lib/store";
import { Card, Empty, Drawer } from "../components/ui";
import { Chart, axisX, axisY } from "../components/Chart";
import { fmtDateTime, nf } from "../lib/format";

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

      <Card title="Recent benchmarks" right={<span className="text-xs text-sub">click a row for the exact op breakdown</span>}>
        {s.benchmarks_recent?.length ? (
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Creator</th>
                <th className="th">Source</th>
                <th className="th text-right">Total</th>
                <th className="th text-right">When</th>
              </tr>
            </thead>
            <tbody>
              {s.benchmarks_recent.map((b: any, i: number) => (
                <tr key={i} onClick={() => setBench(b)} className="cursor-pointer hover:bg-panel2">
                  <td className="td font-mono text-xs">{b.creator_id}</td>
                  <td className="td text-sub">{b.source || "—"}</td>
                  <td className="td text-right">{b.total_ms ? `${Math.round(b.total_ms)} ms` : "—"}</td>
                  <td className="td text-right text-sub">{fmtDateTime(b.ts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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

      <Drawer open={!!bench} onClose={() => setBench(null)} title="Benchmark breakdown">
        {bench && (
          <div className="space-y-3">
            <div className="text-sm">
              <Link to={`/users/${encodeURIComponent(bench.creator_id)}`} className="font-mono text-xs text-brand">{bench.creator_id}</Link>
              <div className="text-sub text-xs mt-1">{bench.source} · {fmtDateTime(bench.ts)} · total {bench.total_ms ? `${Math.round(bench.total_ms)} ms` : "—"}</div>
            </div>
            <div className="card divide-y divide-line/60">
              {Object.entries(bench.ops || {}).length ? (
                Object.entries(bench.ops).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="text-sub font-mono text-xs">{k}</span>
                    <span>{typeof v === "number" ? `${(v as number).toFixed(2)} ms` : String(v)}</span>
                  </div>
                ))
              ) : (
                <div className="px-3 py-2 text-sm text-sub">No per-op data.</div>
              )}
            </div>
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
