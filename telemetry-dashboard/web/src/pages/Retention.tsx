import { useState } from "react";
import { useStats } from "../lib/store";
import { Card, Empty } from "../components/ui";
import { Chart, axisX, axisY } from "../components/Chart";
import { nf } from "../lib/format";

const COLORS = ["#f4b740", "#5b8cff", "#f06363", "#37d399", "#a78bfa", "#22d3ee", "#fb923c", "#e879f9"];

// color a retention % cell (green scale)
function cellBg(pct: number) {
  if (pct >= 100) return "#0f5132";
  if (pct <= 0) return "#13161b";
  const a = Math.max(0.08, Math.min(1, pct / 100));
  return `rgba(55,211,153,${a})`;
}

export default function Retention() {
  const s = useStats()!;
  const [mode, setMode] = useState<"weekly" | "daily">("weekly");
  const cohorts = (mode === "daily" ? (s as any).retention_daily : s.retention) || [];
  const unit = mode === "daily" ? "Day" : "Week";
  const maxCol = Math.max(1, ...cohorts.map((c: any) => c.cells.length));

  const curves = {
    grid: { left: 44, right: 110, top: 16, bottom: 26 },
    legend: { type: "scroll", orient: "vertical", right: 0, top: 10, textStyle: { color: "#9aa3ad", fontSize: 11 } },
    xAxis: axisX(Array.from({ length: maxCol }, (_, i) => String(i))),
    yAxis: axisY({ max: 100, axisLabel: { formatter: "{value}%" } }),
    tooltip: { trigger: "axis" },
    color: COLORS,
    series: cohorts.map((c: any) => ({ name: c.cohort_start, type: "line", smooth: true, showSymbol: false, data: c.cells.map((x: any) => x.pct) })),
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <div className="flex gap-1">
          <button onClick={() => setMode("daily")} className={`pill ${mode === "daily" ? "bg-brand text-white" : "bg-panel2 text-sub"}`}>Quotidien</button>
          <button onClick={() => setMode("weekly")} className={`pill ${mode === "weekly" ? "bg-brand text-white" : "bg-panel2 text-sub"}`}>Hebdomadaire</button>
        </div>
      </div>

      <Card title="Rétention">
        {cohorts.length ? <Chart option={curves} height={300} /> : <Empty>Not enough history yet — retention needs multiple {mode === "daily" ? "days" : "weeks"} of data.</Empty>}
      </Card>

      {cohorts.length > 0 && (
        <Card title="Cohortes">
          <div className="overflow-x-auto">
            <table className="w-full border-separate" style={{ borderSpacing: 4 }}>
              <thead>
                <tr>
                  <th className="th text-left">Cohorte</th>
                  {Array.from({ length: maxCol }, (_, i) => (
                    <th key={i} className="th text-center">{unit} {i}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cohorts.map((c: any) => (
                  <tr key={c.cohort_start}>
                    <td className="td border-0 whitespace-nowrap">
                      <div className="font-medium">{c.cohort_start}</div>
                      <div className="text-[11px] text-sub">{nf(c.size)} users</div>
                    </td>
                    {Array.from({ length: maxCol }, (_, i) => {
                      const cell = c.cells[i];
                      return (
                        <td key={i} className="text-center rounded-md text-xs font-medium" style={{ background: cell ? cellBg(cell.pct) : "transparent", color: cell && cell.pct > 40 ? "#fff" : "#9aa3ad", minWidth: 70, padding: "10px 6px" }}>
                          {cell ? `${cell.pct}%` : ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
