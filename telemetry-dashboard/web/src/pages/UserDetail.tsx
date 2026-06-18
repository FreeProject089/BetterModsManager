import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useStats, apiGet } from "../lib/store";
import { Card, Kpi, Empty } from "../components/ui";
import { Chart } from "../components/Chart";
import { ProfileAvatar, Flag } from "../components/visuals";
import { fmtDate, fmtDateTime, dur, nf } from "../lib/format";

export default function UserDetail() {
  const { id = "" } = useParams();
  const s = useStats()!;
  const u = s.users.find((x) => x.creator_id === id);
  const [journey, setJourney] = useState<any[] | null>(null);

  useEffect(() => {
    let on = true;
    apiGet(`/api/user?id=${encodeURIComponent(id)}`).then((r) => on && setJourney(r.sessions || []));
    return () => {
      on = false;
    };
  }, [id]);

  const flat = useMemo(() => (journey || []).flatMap((sess) => sess.events || []), [journey]);
  const pageEnters = flat.filter((e) => e.event === "page_enter");
  const eventsCount = flat.length;

  // per-day activity for the calendar heatmap
  const byDay = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of flat) {
      const d = (e.ts || "").slice(0, 10);
      if (d) m[d] = (m[d] || 0) + 1;
    }
    return Object.entries(m).map(([d, c]) => [d, c]);
  }, [flat]);

  const topPages = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of pageEnters) if (e.view) m[e.view] = (m[e.view] || 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [pageEnters]);

  if (!u) {
    return (
      <div>
        <Link to="/users" className="text-sm text-brand">← Users</Link>
        <Empty>User not found in the current window.</Empty>
      </div>
    );
  }

  const counts = u.config?.counts && typeof u.config.counts === "object" ? Object.entries(u.config.counts) : [];
  const now = new Date();
  const calStart = new Date(now.getTime() - 150 * 86400000).toISOString().slice(0, 10);
  const calOpt = {
    tooltip: { formatter: (p: any) => `${p.value[0]}: ${p.value[1]} events` },
    visualMap: { min: 0, max: Math.max(4, ...byDay.map((d) => d[1] as number)), show: false, inRange: { color: ["#1b2230", "#264a8f", "#5b8cff", "#37d399"] } },
    calendar: {
      range: [calStart, now.toISOString().slice(0, 10)],
      cellSize: [14, 14],
      top: 10,
      left: 30,
      right: 10,
      splitLine: { show: false },
      itemStyle: { color: "#13161b", borderColor: "#0b0d10", borderWidth: 2 },
      yearLabel: { show: false },
      monthLabel: { color: "#9aa3ad", fontSize: 10 },
      dayLabel: { color: "#9aa3ad", fontSize: 10, firstDay: 1 },
    },
    series: [{ type: "heatmap", coordinateSystem: "calendar", data: byDay }],
  };

  return (
    <div className="space-y-4">
      <Link to="/users" className="text-sm text-brand">← Users</Link>

      <div className="flex items-center gap-4">
        <ProfileAvatar name={u.creator_id} size={56} />
        <div>
          <div className="text-xl font-semibold">{u.names?.[0] || "Anonymous creator"}</div>
          <div className="font-mono text-xs text-sub">{u.creator_id}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Sessions" value={nf(u.sessions)} />
        <Kpi label="Pageviews" value={nf(pageEnters.length)} />
        <Kpi label="Events" value={nf(eventsCount)} />
        <Kpi label="Benchmarks" value={nf(u.benchmarks?.length || 0)} />
        <Kpi label="First seen" value={<span className="text-base">{fmtDate(u.first_seen)}</span>} />
        <Kpi label="Last seen" value={<span className="text-base">{fmtDate(u.last_seen)}</span>} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Location & device" className="xl:col-span-1">
          <div className="divide-y divide-line/60 -mx-1">
            <Info k="Country" v={<span><Flag cc={u.cc} /> {u.country || "—"}</span>} />
            <Info k="Region" v={u.region || "—"} />
            <Info k="City (approx)" v={u.city || "—"} />
            <Info k="Language" v={u.config?.locale || "—"} />
            <Info k="OS" v={u.config?.os || "—"} />
            <Info k="CPU" v={u.config?.cpu || "—"} />
            <Info k="GPU" v={u.config?.gpu || "—"} />
            <Info k="RAM" v={u.config?.ram_gb ? `${u.config.ram_gb} GB` : "—"} />
            <Info k="Theme" v={u.config?.theme ? `${u.config.theme} (${u.config.theme_kind || "?"})` : "—"} />
            <Info k="IP" v={<span className="font-mono text-xs">{u.ips?.[0] || "—"}</span>} />
          </div>
        </Card>

        <Card title="Activity" className="xl:col-span-2">
          {byDay.length ? <Chart option={calOpt} height={180} /> : <Empty>No activity recorded.</Empty>}
          <div className="mt-3">
            <div className="text-[11px] uppercase tracking-wide text-sub mb-1">Top pages</div>
            {topPages.length ? (
              <div className="flex flex-wrap gap-2">
                {topPages.map(([v, c]) => (
                  <span key={v} className="pill bg-panel2">
                    {v} <span className="text-sub">· {c}</span>
                  </span>
                ))}
              </div>
            ) : (
              <Empty>No pages.</Empty>
            )}
          </div>
        </Card>
      </div>

      {counts.length > 0 && (
        <Card title="BMM content">
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
            {counts.map(([k, v]) => (
              <div key={k} className="card px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-sub">{k.replace(/_/g, " ")}</div>
                <div className="text-xl font-semibold">{nf(v as number)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Session journeys">
        {journey == null ? (
          <Empty>Loading…</Empty>
        ) : journey.length ? (
          <div className="space-y-3">
            {journey.map((sess) => (
              <div key={sess.session_id} className="card p-3">
                <div className="flex items-center justify-between text-xs text-sub mb-2">
                  <span className="font-mono">{sess.session_id}</span>
                  <span>
                    {fmtDateTime(sess.start)} · {dur((new Date(sess.end).getTime() - new Date(sess.start).getTime()) / 1000)} · {sess.events?.length || 0} events
                  </span>
                </div>
                <ol className="relative border-l border-line ml-2 space-y-1">
                  {(sess.events || []).slice(0, 40).map((e: any, i: number) => (
                    <li key={i} className="ml-3 text-sm">
                      <span className="absolute -left-[5px] w-2 h-2 rounded-full bg-brand mt-1.5" />
                      <span className="text-sub text-xs mr-2">{(e.ts || "").slice(11, 19)}</span>
                      <span className="font-medium">{e.event}</span>
                      {e.detail && <span className="text-sub"> · {e.detail}</span>}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        ) : (
          <Empty>No sessions recorded.</Empty>
        )}
      </Card>
    </div>
  );
}

function Info({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-1 py-2 text-sm">
      <span className="text-sub">{k}</span>
      <span className="text-right max-w-[60%] truncate">{v}</span>
    </div>
  );
}
