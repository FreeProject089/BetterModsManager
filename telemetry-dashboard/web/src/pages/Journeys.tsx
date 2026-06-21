import { useEffect, useMemo, useState } from "react";
import { apiPost, useStats } from "../lib/store";
import { buildCatalog } from "../lib/constants";
import { Card, Empty } from "../components/ui";
import { Chart } from "../components/Chart";

export default function Journeys() {
  const s = useStats()!;
  const { pages: views, modals, diagrams, tabs, guides } = useMemo(() => buildCatalog(s), [s]);
  const [steps, setSteps] = useState(4);
  const [limit, setLimit] = useState(50);
  const [filters, setFilters] = useState<string[]>(["", "", "", "", "", ""]);
  const [res, setRes] = useState<any | null>(null);

  // refetch when steps / limit / filters change (debounced)
  useEffect(() => {
    const id = setTimeout(() => {
      apiPost("/api/journeys", { steps, limit, filters: filters.slice(0, steps) }).then(setRes);
    }, 250);
    return () => clearTimeout(id);
  }, [steps, limit, filters]);

  const labelMap = useMemo(() => {
    const m: Record<string, string> = {};
    (res?.nodes || []).forEach((n: any) => (m[n.name] = n.label));
    return m;
  }, [res]);

  const opt = res && res.nodes?.length && {
    tooltip: { trigger: "item", triggerOn: "mousemove", formatter: (p: any) => (p.dataType === "edge" ? `${labelMap[p.data.source]} → ${labelMap[p.data.target]}: ${p.data.value}` : `${labelMap[p.name] || p.name}`) },
    series: [
      {
        type: "sankey",
        left: "5%",
        right: "15%",
        data: res.nodes.map((n: any) => ({ name: n.name, depth: n.depth })),
        links: res.links,
        emphasis: { focus: "adjacency" },
        nodeAlign: "left",
        nodeGap: 8,
        lineStyle: { color: "gradient", curveness: 0.5, opacity: 0.35 },
        itemStyle: { color: "#5b8cff", borderColor: "transparent" },
        label: { color: "#e8eaed", fontSize: 11, formatter: (p: any) => labelMap[p.name] || p.name },
        color: ["#5b8cff", "#37d399", "#f4b740", "#a78bfa", "#22d3ee", "#f06363"],
      },
    ],
  };

  return (
    <div className="space-y-4">
      <Card title="Parcours utilisateurs">
        <div className="flex flex-wrap items-center gap-6 mb-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-sub whitespace-nowrap">{steps} étapes</span>
            <input type="range" min={2} max={6} value={steps} onChange={(e) => setSteps(+e.target.value)} className="accent-brand" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-sub whitespace-nowrap">{limit} parcours</span>
            <input type="range" min={10} max={100} step={5} value={limit} onChange={(e) => setLimit(+e.target.value)} className="accent-brand" />
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          {Array.from({ length: Math.min(steps, 4) }, (_, i) => (
            <select
              key={i}
              value={filters[i]}
              onChange={(e) => setFilters((f) => f.map((x, j) => (j === i ? e.target.value : x)))}
              className="bg-panel2 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand"
            >
              <option value="">Étape {i + 1} — any step</option>
              <option value="*">Any (wildcard)</option>
              <optgroup label="Pages">
                {views.map((x: string) => <option key={`v-${x}`} value={x}>{x}</option>)}
              </optgroup>
              {tabs.length > 0 && (
                <optgroup label="Tabs">
                  {tabs.map((x: string) => <option key={`t-${x}`} value={x}>{x}</option>)}
                </optgroup>
              )}
              <optgroup label="Modals">
                {modals.map((x: string) => <option key={`m-${x}`} value={x}>{x}</option>)}
              </optgroup>
              <optgroup label="Diagrams">
                {diagrams.map((x: string) => <option key={`d-${x}`} value={x}>{x}</option>)}
              </optgroup>
              {guides.length > 0 && (
                <optgroup label="Guides">
                  {guides.map((x: string) => <option key={`g-${x}`} value={x}>{x}</option>)}
                </optgroup>
              )}
            </select>
          ))}
        </div>
        <div className="text-[11px] text-sub mt-1">Filtre par sous-chaîne, ou * pour n'importe quelle page à cette étape.</div>
      </Card>

      <Card title={res ? `Flux · ${res.paths} parcours distincts` : "Flux"}>
        {opt ? <Chart option={opt} height={560} /> : <Empty>Pas encore assez de navigation pour tracer un parcours.</Empty>}
      </Card>
    </div>
  );
}
