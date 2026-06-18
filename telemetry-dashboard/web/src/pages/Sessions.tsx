import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useStore, apiGet } from "../lib/store";
import { Card, Empty, Drawer } from "../components/ui";
import { ProfileAvatar, Flag, ArrowIcon } from "../components/visuals";
import { fmtDateTime, dur, nf } from "../lib/format";

// Group a flat event stream into per-page segments so you can analyze what
// happened *on* each page (clicks, perf, modals, features…).
function groupByPage(events: any[]) {
  const groups: { view: string; start: string; events: any[]; dwell?: number }[] = [];
  let cur: any = null;
  for (const e of events) {
    if (e.event === "page_enter") {
      cur = { view: e.view || "(unknown)", start: e.ts, events: [] };
      groups.push(cur);
    } else if (e.event === "page_leave") {
      if (cur) cur.dwell = Math.round((e.dwell_ms || 0) / 1000);
    } else {
      if (!cur) {
        cur = { view: "(before first page)", start: e.ts, events: [] };
        groups.push(cur);
      }
      cur.events.push(e);
    }
  }
  return groups;
}

export default function Sessions() {
  const { stats } = useStore();
  const [rows, setRows] = useState<any[]>([]);
  const [sel, setSel] = useState<any | null>(null);
  const [journey, setJourney] = useState<any[] | null>(null);

  const ccOf = (id: string) => stats?.users.find((u) => u.creator_id === id)?.cc;

  const load = () => apiGet("/api/sessions").then((r) => setRows(r.sessions || []));
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!sel) return;
    setJourney(null);
    apiGet(`/api/user?id=${encodeURIComponent(sel.distinct_id)}`).then((r) => {
      const j = (r.sessions || []).find((x: any) => x.session_id === sel.session_id);
      setJourney(j ? j.events : []);
    });
  }, [sel]);

  const pages = useMemo(() => (journey ? groupByPage(journey) : []), [journey]);

  return (
    <div>
      <Card title={`Recent sessions · ${rows.length}`}>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">User</th>
                  <th className="th">Path</th>
                  <th className="th text-right">Pages</th>
                  <th className="th text-right">Events</th>
                  <th className="th text-right">Duration</th>
                  <th className="th text-right">When</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.session_id} onClick={() => setSel(r)} className="cursor-pointer hover:bg-panel2">
                    <td className="td">
                      <span className="flex items-center gap-2">
                        <ProfileAvatar name={r.distinct_id} size={22} />
                        <Flag cc={ccOf(r.distinct_id)} />
                        <span className="font-mono text-xs">{r.distinct_id}</span>
                      </span>
                    </td>
                    <td className="td text-sub">
                      <span className="inline-flex items-center gap-1">{r.entry || "—"} <ArrowIcon /> {r.exit || "—"}</span>
                    </td>
                    <td className="td text-right">{nf(r.pageviews)}</td>
                    <td className="td text-right">{nf(r.events)}</td>
                    <td className="td text-right">{dur(r.duration_s)}</td>
                    <td className="td text-right text-sub">{fmtDateTime(r.end)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No sessions yet.</Empty>
        )}
      </Card>

      <Drawer open={!!sel} onClose={() => setSel(null)} title="Session breakdown" width={640}>
        {sel && (
          <div className="space-y-3">
            <div className="text-sm">
              <Link to={`/users/${encodeURIComponent(sel.distinct_id)}`} className="font-mono text-xs text-brand">{sel.distinct_id}</Link>
              <div className="text-sub text-xs mt-1">{fmtDateTime(sel.start)} · {dur(sel.duration_s)} · {sel.pageviews} pages · {sel.events} events</div>
            </div>
            {journey == null ? (
              <Empty>Loading…</Empty>
            ) : pages.length ? (
              <div className="space-y-2">
                {pages.map((g, i) => (
                  <div key={i} className="card p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm flex items-center gap-2"><ArrowIcon className="text-sub" /> {g.view}</span>
                      <span className="text-xs text-sub">{(g.start || "").slice(11, 19)}{g.dwell != null ? ` · ${g.dwell}s` : ""} · {g.events.length} events</span>
                    </div>
                    {g.events.length ? (
                      <ul className="space-y-1">
                        {g.events.map((e: any, j: number) => (
                          <li key={j} className="text-sm flex items-center gap-2">
                            <span className="text-sub text-[11px] w-14 shrink-0">{(e.ts || "").slice(11, 19)}</span>
                            <span className="pill bg-panel2">{e.event}</span>
                            {e.detail && <span className="text-sub text-xs truncate">{e.detail}</span>}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-xs text-sub">No in-page events recorded.</div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <Empty>No events in this session.</Empty>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
