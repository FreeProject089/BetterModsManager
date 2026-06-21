import { useMemo, useState } from "react";
import { useStore, apiPost, apiDelete } from "../lib/store";
import { buildCatalog } from "../lib/constants";
import { Card, Empty, Bar } from "../components/ui";
import { nf } from "../lib/format";

type GoalType = "page" | "event" | "modal" | "feature";
const TYPE_LABEL: Record<GoalType, string> = { page: "Page visited", event: "Event fired", modal: "Modal opened", feature: "Feature used" };

export default function Goals() {
  const { stats, adminKey } = useStore();
  const s = stats!;
  const cat = useMemo(() => buildCatalog(s), [s]);
  const [name, setName] = useState("");
  const [type, setType] = useState<GoalType>("page");
  const [target, setTarget] = useState("");
  const [count, setCount] = useState("1");
  const [err, setErr] = useState("");

  const options = useMemo(() => {
    switch (type) {
      case "page": return Array.from(new Set([...cat.pages, ...cat.tabs])).sort();
      case "event": return cat.events;
      case "modal": return Array.from(new Set([...cat.modals, ...cat.diagrams, ...cat.guides])).sort();
      case "feature": return cat.features;
    }
  }, [type, cat]);

  const add = async () => {
    setErr("");
    if (!adminKey) return setErr("Set the admin key (top-right) to create goals.");
    if (!name.trim() || !target.trim()) return setErr("Name and target are required.");
    const target_count = Math.max(1, parseInt(count, 10) || 1);
    const r = await apiPost("/api/goals", { name: name.trim(), type, target: target.trim(), target_count }, adminKey);
    if (r.error) return setErr(r.error);
    setName(""); setTarget(""); setCount("1");
  };
  const remove = async (id: number) => {
    if (!adminKey) return;
    await apiDelete(`/api/goals/${id}`, adminKey);
  };

  return (
    <div className="space-y-4">
      <Card title="Define a goal">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Goal name" className="md:col-span-3 bg-panel2 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand" />
          <select value={type} onChange={(e) => { setType(e.target.value as GoalType); setTarget(""); }} className="md:col-span-2 bg-panel2 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand">
            {(Object.keys(TYPE_LABEL) as GoalType[]).map((k) => (
              <option key={k} value={k}>{TYPE_LABEL[k]}</option>
            ))}
          </select>
          <input list="goal-targets" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="target (type or pick any)" className="md:col-span-3 bg-panel2 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand" />
          <datalist id="goal-targets">
            {options.map((o: string) => (
              <option key={o} value={o} />
            ))}
          </datalist>
          <div className="md:col-span-2 flex items-center gap-2">
            <span className="text-xs text-sub whitespace-nowrap">reach</span>
            <input value={count} onChange={(e) => setCount(e.target.value.replace(/[^0-9]/g, ""))} type="number" min={1} className="w-full bg-panel2 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand" />
            <span className="text-xs text-sub">users</span>
          </div>
          <button onClick={add} className="md:col-span-2 bg-brand text-white rounded-lg px-4 py-2 text-sm font-medium">Add goal</button>
        </div>
        {err && <div className="text-bad text-xs mt-2">{err}</div>}
        {!adminKey && <div className="text-sub text-xs mt-2">Read-only — enter the admin key to create or delete goals.</div>}
      </Card>

      {s.goals.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {s.goals.map((g: any) => {
            const tc = g.target_count || 1;
            const progress = g.progress != null ? g.progress : Math.min(100, (g.conversions / tc) * 100);
            return (
              <Card key={g.id} title={g.name} right={adminKey ? <button onClick={() => remove(g.id)} className="text-sub hover:text-bad text-xs">Delete</button> : null}>
                <div className="text-xs text-sub mb-2">
                  <span className="pill bg-panel2 mr-1">{TYPE_LABEL[(g.type as GoalType)] || g.type}</span>
                  <span className="font-mono">{g.target}</span>
                </div>
                <div className="flex items-end justify-between mb-1">
                  <div className="text-3xl font-semibold">{nf(g.conversions)}<span className="text-sub text-base"> / {nf(tc)}</span></div>
                  <div className={`text-sm ${g.reached ? "text-good" : "text-sub"}`}>{g.reached ? "Reached" : `${progress}%`}</div>
                </div>
                <Bar pct={progress} color={g.reached ? "bg-good" : "bg-brand"} />
                <div className="text-[11px] text-sub mt-1">{g.rate}% of all {nf(s.totals.users)} users</div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Empty>No goals yet. Define one above to track conversion.</Empty>
      )}
    </div>
  );
}
