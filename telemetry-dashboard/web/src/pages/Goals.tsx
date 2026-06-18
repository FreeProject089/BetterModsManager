import { useMemo, useState } from "react";
import { useStore, apiPost, apiDelete } from "../lib/store";
import { Card, Empty, Bar } from "../components/ui";
import { nf } from "../lib/format";

type GoalType = "page" | "event" | "modal" | "feature";
const TYPE_LABEL: Record<GoalType, string> = { page: "Page visited", event: "Event fired", modal: "Modal opened", feature: "Feature used" };

export default function Goals() {
  const { stats, adminKey } = useStore();
  const s = stats!;
  const [name, setName] = useState("");
  const [type, setType] = useState<GoalType>("page");
  const [target, setTarget] = useState("");
  const [err, setErr] = useState("");

  const options = useMemo(() => {
    switch (type) {
      case "page": return s.pages.map((p) => p.view);
      case "event": return s.events.map((e) => e.event);
      case "modal": return (s.modals || []).map((m: any) => m.k);
      case "feature": return (s.features || []).map((f: any) => f.k);
    }
  }, [type, s]);

  const add = async () => {
    setErr("");
    if (!adminKey) return setErr("Set the admin key (top-right) to create goals.");
    if (!name.trim() || !target.trim()) return setErr("Name and target are required.");
    const r = await apiPost("/api/goals", { name: name.trim(), type, target: target.trim() }, adminKey);
    if (r.error) return setErr(r.error);
    setName("");
    setTarget("");
  };
  const remove = async (id: number) => {
    if (!adminKey) return;
    await apiDelete(`/api/goals/${id}`, adminKey);
  };

  return (
    <div className="space-y-4">
      <Card title="Define a goal">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Goal name" className="md:col-span-4 bg-panel2 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand" />
          <select value={type} onChange={(e) => { setType(e.target.value as GoalType); setTarget(""); }} className="md:col-span-3 bg-panel2 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand">
            {(Object.keys(TYPE_LABEL) as GoalType[]).map((k) => (
              <option key={k} value={k}>{TYPE_LABEL[k]}</option>
            ))}
          </select>
          <select value={target} onChange={(e) => setTarget(e.target.value)} className="md:col-span-3 bg-panel2 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand">
            <option value="">— choose target —</option>
            {options.map((o: string) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <button onClick={add} className="md:col-span-2 bg-brand text-white rounded-lg px-4 py-2 text-sm font-medium">Add goal</button>
        </div>
        {err && <div className="text-bad text-xs mt-2">{err}</div>}
        {!adminKey && <div className="text-sub text-xs mt-2">Read-only — enter the admin key to create or delete goals.</div>}
      </Card>

      {s.goals.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {s.goals.map((g: any) => (
            <Card key={g.id} title={g.name} right={adminKey ? <button onClick={() => remove(g.id)} className="text-sub hover:text-bad text-xs">Delete</button> : null}>
              <div className="text-xs text-sub mb-2">
                <span className="pill bg-panel2 mr-1">{TYPE_LABEL[(g.type as GoalType)] || g.type}</span>
                <span className="font-mono">{g.target}</span>
              </div>
              <div className="flex items-end justify-between mb-1">
                <div className="text-3xl font-semibold">{g.rate}%</div>
                <div className="text-sm text-sub">{nf(g.conversions)} of {nf(s.totals.users)} users</div>
              </div>
              <Bar pct={g.rate} color="bg-good" />
            </Card>
          ))}
        </div>
      ) : (
        <Empty>No goals yet. Define one above to track conversion.</Empty>
      )}
    </div>
  );
}
