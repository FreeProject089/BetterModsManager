import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useStore, apiGet } from "../lib/store";
import { Card, Empty, Drawer } from "../components/ui";
import { ProfileAvatar, Flag, ArrowIcon } from "../components/visuals";
import { classify, EventTimeline, TypeChips, type TypeKey } from "../components/events";
import { RrwebReplay } from "../components/RrwebReplay";
import { fmtDateTime, dur, nf } from "../lib/format";

export default function Sessions() {
  const { stats } = useStore();
  const [rows, setRows] = useState<any[]>([]);
  const [sel, setSel] = useState<any | null>(null);
  const [journey, setJourney] = useState<any[] | null>(null);
  const [tab, setTab] = useState<"timeline" | "replay" | "info">("timeline");
  const [hidden, setHidden] = useState<Set<TypeKey>>(new Set());

  const userOf = (id: string) => stats?.users.find((u) => u.creator_id === id);

  const load = () => apiGet("/api/sessions").then((r) => setRows(r.sessions || []));
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!sel) return;
    setJourney(null);
    setTab("timeline");
    setHidden(new Set());
    apiGet(`/api/user?id=${encodeURIComponent(sel.distinct_id)}`).then((r) => {
      const j = (r.sessions || []).find((x: any) => x.session_id === sel.session_id);
      setJourney(j ? j.events : []);
    });
  }, [sel]);

  // timeline events = everything except internal page_leave/perf
  const events = useMemo(() => (journey || []).filter((e) => e.event !== "page_leave" && e.event !== "perf"), [journey]);
  const counts = useMemo(() => {
    const m: Partial<Record<TypeKey, number>> = {};
    for (const e of events) { const k = classify(e); m[k] = (m[k] || 0) + 1; }
    return m;
  }, [events]);
  const shown = events.filter((e) => !hidden.has(classify(e)));
  const u = sel ? userOf(sel.distinct_id) : null;

  const toggle = (k: TypeKey) => setHidden((h) => { const n = new Set(h); n.has(k) ? n.delete(k) : n.add(k); return n; });

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
                        <Flag cc={userOf(r.distinct_id)?.cc} />
                        <span className="font-mono text-xs">{r.distinct_id}</span>
                      </span>
                    </td>
                    <td className="td text-sub"><span className="inline-flex items-center gap-1">{r.entry || "—"} <ArrowIcon /> {r.exit || "—"}</span></td>
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

      <Drawer open={!!sel} onClose={() => setSel(null)} title="Session" width={680}>
        {sel && (
          <div className="space-y-4">
            {/* header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ProfileAvatar name={sel.distinct_id} size={36} />
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Flag cc={u?.cc} /> <span className="font-mono text-xs">{sel.distinct_id}</span>
                  </div>
                  <div className="text-xs text-sub">{u?.config?.os || "—"} · {fmtDateTime(sel.start)} · {dur(sel.duration_s)}</div>
                </div>
              </div>
              <Link to={`/users/${encodeURIComponent(sel.distinct_id)}`} className="pill bg-brand text-white">Voir l'utilisateur</Link>
            </div>

            {/* tabs */}
            <div className="flex gap-1">
              <button onClick={() => setTab("timeline")} className={`pill ${tab === "timeline" ? "bg-panel2 text-ink" : "text-sub"}`}>Chronologie</button>
              <button onClick={() => setTab("replay")} className={`pill ${tab === "replay" ? "bg-panel2 text-ink" : "text-sub"}`}>Replay</button>
              <button onClick={() => setTab("info")} className={`pill ${tab === "info" ? "bg-panel2 text-ink" : "text-sub"}`}>Info session</button>
            </div>

            {journey == null ? (
              <Empty>Loading…</Empty>
            ) : tab === "replay" ? (
              <RrwebReplay sessionId={sel.session_id} fallbackEvents={journey} />
            ) : tab === "info" ? (
              <div className="card divide-y divide-line/60">
                <Info k="Session id" v={<span className="font-mono text-xs">{sel.session_id}</span>} />
                <Info k="Entry → Exit" v={`${sel.entry || "—"} → ${sel.exit || "—"}`} />
                <Info k="Duration" v={dur(sel.duration_s)} />
                <Info k="Pageviews" v={nf(sel.pageviews)} />
                <Info k="Events" v={nf(sel.events)} />
                <Info k="Country" v={<span><Flag cc={u?.cc} /> {u?.country || "—"}</span>} />
                <Info k="OS / GPU" v={`${u?.config?.os || "—"} · ${u?.config?.gpu || "—"}`} />
                <Info k="Version" v={u?.versions?.[0] || "—"} />
              </div>
            ) : (
              <>
                <TypeChips counts={counts} hidden={hidden} onToggle={toggle} />
                {shown.length ? <EventTimeline events={events} hidden={hidden} /> : <Empty>No events match the selected filters.</Empty>}
                <div className="text-center text-xs text-sub">Showing {shown.length} of {events.length} events</div>
              </>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}

function Info({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 text-sm">
      <span className="text-sub">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}
