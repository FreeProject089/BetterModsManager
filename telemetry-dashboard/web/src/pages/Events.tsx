import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useStats, apiGet } from "../lib/store";
import { Card, Empty, Drawer } from "../components/ui";
import { fmtDateTime, nf } from "../lib/format";

export default function Events() {
  const s = useStats()!;
  const [sel, setSel] = useState<string | null>(null);
  const [occ, setOcc] = useState<any[] | null>(null);

  useEffect(() => {
    if (!sel) return;
    setOcc(null);
    apiGet(`/api/event?name=${encodeURIComponent(sel)}&limit=80`).then((r) => setOcc(r.occurrences || []));
  }, [sel]);

  const groups: { title: string; rows: { k: string; v: number }[] }[] = [
    { title: "Events", rows: s.events.map((e) => ({ k: e.event, v: e.count })) },
    { title: "Features used", rows: s.features },
    { title: "Modals opened", rows: s.modals },
    { title: "Tutorials", rows: s.tutorial },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {groups.map((g) => (
          <Card key={g.title} title={g.title}>
            {g.rows.length ? (
              <div className="divide-y divide-line/60">
                {g.rows.map((r) => (
                  <button key={r.k} onClick={() => setSel(g.title === "Events" ? r.k : null)} className={`w-full flex items-center justify-between px-2 py-2 text-sm ${g.title === "Events" ? "hover:bg-panel2 cursor-pointer" : "cursor-default"}`}>
                    <span className="font-mono text-xs">{r.k}</span>
                    <span className="font-medium">{nf(r.v)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <Empty>None yet.</Empty>
            )}
          </Card>
        ))}
      </div>

      <Drawer open={!!sel} onClose={() => setSel(null)} title={<span className="font-mono text-xs">{sel}</span>} width={640}>
        {occ == null ? (
          <Empty>Loading…</Empty>
        ) : occ.length ? (
          <div className="space-y-2">
            {occ.map((o, i) => (
              <div key={i} className="card p-3 text-sm">
                <div className="flex items-center justify-between mb-1">
                  <Link to={`/users/${encodeURIComponent(o.distinct_id)}`} className="font-mono text-xs text-brand">
                    {o.distinct_id}
                  </Link>
                  <span className="text-sub text-xs">{fmtDateTime(o.ts)}</span>
                </div>
                <pre className="text-[11px] text-sub whitespace-pre-wrap break-all bg-panel2 rounded p-2 max-h-40 overflow-auto">{JSON.stringify(o.props, null, 1)}</pre>
              </div>
            ))}
          </div>
        ) : (
          <Empty>No occurrences.</Empty>
        )}
      </Drawer>
    </div>
  );
}
