import { useStats } from "../lib/store";
import { Card, Empty } from "../components/ui";
import { Chart, axisX, axisY } from "../components/Chart";

export default function Retention() {
  const s = useStats()!;
  const cohorts = s.retention || [];
  const maxWeek = Math.max(1, ...cohorts.map((c: any) => c.cells.length));

  // heatmap data: [weekIndex, cohortIndex, pct]
  const data: any[] = [];
  cohorts.forEach((c: any, ci: number) => {
    c.cells.forEach((cell: any) => data.push([cell.week, ci, cell.pct]));
  });
  const heat = {
    grid: { left: 90, right: 16, top: 16, bottom: 30 },
    xAxis: { ...axisX(Array.from({ length: maxWeek }, (_, i) => `W${i}`)), splitArea: { show: true } },
    yAxis: { type: "category", data: cohorts.map((c: any) => `${c.cohort_start} (${c.size})`), axisLabel: { color: "#9aa3ad", fontSize: 10 } },
    visualMap: { min: 0, max: 100, calculable: false, show: false, inRange: { color: ["#1b2230", "#264a8f", "#5b8cff", "#37d399"] } },
    tooltip: { formatter: (p: any) => `Week ${p.value[0]}: ${p.value[2]}%` },
    series: [{ type: "heatmap", data, label: { show: true, color: "#e8eaed", fontSize: 10, formatter: (p: any) => (p.value[2] ? `${p.value[2]}%` : "") }, itemStyle: { borderColor: "#0b0d10", borderWidth: 2 } }],
  };

  const curves = {
    grid: { left: 40, right: 16, top: 20, bottom: 26 },
    xAxis: axisX(Array.from({ length: maxWeek }, (_, i) => `W${i}`)),
    yAxis: axisY({ max: 100, axisLabel: { formatter: "{value}%" } }),
    tooltip: { trigger: "axis" },
    series: cohorts.map((c: any) => ({ name: c.cohort_start, type: "line", smooth: true, showSymbol: false, data: c.cells.map((x: any) => x.pct) })),
  };

  return (
    <div className="space-y-4">
      <Card title="Weekly retention cohorts">
        {cohorts.length ? <Chart option={heat} height={Math.max(200, cohorts.length * 34 + 60)} /> : <Empty>Not enough history yet — retention needs multiple weeks of data.</Empty>}
      </Card>
      {cohorts.length > 0 && (
        <Card title="Retention curves">
          <Chart option={curves} height={300} />
        </Card>
      )}
    </div>
  );
}
