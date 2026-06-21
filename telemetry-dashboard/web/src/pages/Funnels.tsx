import { useMemo, useState } from "react";
import { useStats, apiPost } from "../lib/store";
import { buildCatalog } from "../lib/constants";
import { Card, Empty, Bar } from "../components/ui";
import { Chart, axisX, axisY } from "../components/Chart";

export default function Funnels() {
  const s = useStats()!;
  const cat = useMemo(() => buildCatalog(s), [s]);
  const { pages: views, modals, diagrams, tabs, guides } = cat;
  const [steps, setSteps] = useState<string[]>(["", "", ""]);
  const [res, setRes] = useState<any | null>(null);

  const setStep = (i: number, v: string) => setSteps((s) => s.map((x, j) => (j === i ? v : x)));
  const addStep = () => setSteps((s) => [...s, ""]);
  const removeStep = (i: number) => setSteps((s) => (s.length > 2 ? s.filter((_, j) => j !== i) : s));

  const run = async () => {
    const clean = steps.map((x) => x.trim()).filter(Boolean);
    if (clean.length < 2) return;
    setRes(await apiPost("/api/funnel", { steps: clean }));
  };

  const funnelOpt = res && {
    grid: { left: 40, right: 16, top: 16, bottom: 40 },
    xAxis: axisX(res.steps.map((st: any, i: number) => `${i + 1}. ${st.step}`)),
    yAxis: axisY(),
    series: [
      {
        type: "bar",
        data: res.steps.map((st: any) => st.count),
        barWidth: "50%",
        itemStyle: { color: "#5b8cff", borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: "top", color: "#e8eaed", formatter: (p: any) => `${res.steps[p.dataIndex].pct}%` },
      },
    ],
    tooltip: { trigger: "axis" },
  };

  // "Parcours" — a Sankey of the most common from→view transitions.
  const links = (s.funnels || [])
    .map((f: any) => {
      const [a, b] = f.path.split("→");
      return { source: (a || "").trim(), target: (b || "").trim(), value: f.count };
    })
    .filter((l: any) => l.source && l.target && l.source !== l.target)
    .slice(0, 30);
  const nodeNames = Array.from(new Set(links.flatMap((l: any) => [l.source, l.target])));
  const sankeyOpt = {
    tooltip: { trigger: "item", triggerOn: "mousemove" },
    series: [
      {
        type: "sankey",
        left: "5%",
        right: "15%",
        data: nodeNames.map((n) => ({ name: n })),
        links,
        emphasis: { focus: "adjacency" },
        lineStyle: { color: "gradient", curveness: 0.5, opacity: 0.4 },
        itemStyle: { color: "#5b8cff", borderColor: "transparent" },
        label: { color: "#e8eaed", fontSize: 11 },
        nodeGap: 10,
      },
    ],
  };

  return (
    <div className="space-y-4">
      <Card title="Build a funnel" right={<span className="text-xs text-sub">pages & modals · “Any” = wildcard step</span>}>
        <div className="space-y-2">
          {steps.map((v, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-panel2 text-xs flex items-center justify-center shrink-0">{i + 1}</span>
              <select value={v} onChange={(e) => setStep(i, e.target.value)} className="flex-1 bg-panel2 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand">
                <option value="">— choose a step —</option>
                <option value="*">Any (wildcard)</option>
                <optgroup label="Pages">
                  {views.map((x) => (
                    <option key={`v-${x}`} value={x}>{x}</option>
                  ))}
                </optgroup>
                <optgroup label="Modals">
                  {modals.map((x: string) => (
                    <option key={`m-${x}`} value={x}>{x}</option>
                  ))}
                </optgroup>
                {tabs.length > 0 && (
                  <optgroup label="Tabs">
                    {tabs.map((x: string) => (
                      <option key={`t-${x}`} value={x}>{x}</option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Diagrams">
                  {diagrams.map((x: string) => (
                    <option key={`d-${x}`} value={x}>{x}</option>
                  ))}
                </optgroup>
                {guides.length > 0 && (
                  <optgroup label="Guides">
                    {guides.map((x: string) => (
                      <option key={`g-${x}`} value={x}>{x}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              <button onClick={() => removeStep(i)} className="text-sub hover:text-bad px-2" title="Remove step">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={addStep} className="bg-panel2 text-sub rounded-lg px-3 py-2 text-sm">+ Add step</button>
          <button onClick={run} className="bg-brand text-white rounded-lg px-4 py-2 text-sm font-medium">Compute funnel</button>
        </div>
      </Card>

      {res && (
        <Card title={`Funnel · ${res.total} sessions entered`}>
          {res.steps?.length ? (
            <>
              <Chart option={funnelOpt} height={280} />
              <div className="mt-3 space-y-2">
                {res.steps.map((st: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <span className="w-44 truncate">{i + 1}. {st.step}</span>
                    <div className="flex-1"><Bar pct={st.pct} /></div>
                    <span className="w-16 text-right">{st.count}</span>
                    <span className="w-14 text-right text-sub">{st.pct}%</span>
                    {st.drop > 0 && <span className="w-20 text-right text-bad text-xs">-{st.drop} drop</span>}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <Empty>Pick at least two steps.</Empty>
          )}
        </Card>
      )}

      <Card title="Parcours — most common page-to-page flow">
        {links.length ? <Chart option={sankeyOpt} height={Math.max(280, nodeNames.length * 24)} /> : <Empty>Not enough navigation data yet.</Empty>}
      </Card>
    </div>
  );
}
