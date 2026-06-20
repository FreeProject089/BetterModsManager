import { useState } from "react";
import { Link } from "react-router-dom";
import { useStats } from "../lib/store";
import { Card, StatusDot, Empty, Drawer } from "../components/ui";
import { ProfileAvatar, Flag } from "../components/visuals";
import { ago, fmtDateTime, dur } from "../lib/format";
import type { LiveInstance } from "../lib/types";

const STATUS_LABEL: Record<string, string> = { online: "Online", away: "Idle", crashed: "Crashed", offline: "Offline" };

export default function Live() {
  const s = useStats()!;
  const [sel, setSel] = useState<LiveInstance | null>(null);
  // keep the selected instance fresh as data streams in
  const current = sel ? s.live.find((l) => l.creator_id === sel.creator_id) || sel : null;

  return (
    <div className="space-y-4">
      <Card title={`Live instances · ${s.live.length}`} right={<span className="text-xs text-sub">click a row for session + device details</span>}>
        {s.live.length ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Status</th>
                  <th className="th">Creator</th>
                  <th className="th">Location</th>
                  <th className="th">View</th>
                  <th className="th">Version</th>
                  <th className="th text-right">FPS</th>
                  <th className="th text-right">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {s.live.map((l) => (
                  <tr key={l.creator_id} onClick={() => setSel(l)} className="cursor-pointer hover:bg-panel2">
                    <td className="td">
                      <span className="pill bg-panel2 whitespace-nowrap">
                        <StatusDot status={l.status} /> {STATUS_LABEL[l.status]}
                      </span>
                    </td>
                    <td className="td font-mono text-xs whitespace-nowrap">
                      <span className="flex items-center gap-2"><ProfileAvatar name={l.creator_id} size={20} /> {l.creator_id}</span>
                    </td>
                    <td className="td whitespace-nowrap"><Flag cc={l.cc} /> {l.country || "—"}</td>
                    <td className="td whitespace-nowrap">{l.view || "—"}</td>
                    <td className="td text-sub whitespace-nowrap">{l.version || "—"}</td>
                    <td className="td text-right whitespace-nowrap">{l.fps ?? "—"}</td>
                    <td className="td text-right text-sub whitespace-nowrap">{ago(l.ago_s)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No instances have reported in the last few minutes.</Empty>
        )}
      </Card>

      <Drawer open={!!current} onClose={() => setSel(null)} title={current ? <span className="font-mono text-xs">{current.creator_id}</span> : ""}>
        {current && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="pill bg-panel2">
                <StatusDot status={current.status} /> {STATUS_LABEL[current.status]}
              </span>
              {current.status === "crashed" && <span className="text-bad text-xs">⚠ no clean session end — likely crashed</span>}
              {current.is_vm && <span className="pill bg-panel2 text-warn">VM</span>}
            </div>

            <Section title="Session">
              <Row k="Session id" v={<span className="font-mono text-xs">{current.session_id || "—"}</span>} />
              <Row k="Started" v={fmtDateTime(current.started_at)} />
              <Row k="Uptime" v={current.started_at ? dur((Date.now() - current.started_at) / 1000) : "—"} />
              <Row k="Current view" v={current.view || "—"} />
              <Row k="Last heartbeat" v={`${ago(current.ago_s)} ago`} />
            </Section>

            <Section title="Performance">
              <Row k="FPS (avg)" v={current.fps ?? "—"} />
              <Row k="Frame time" v={current.ft != null ? `${current.ft} ms` : "—"} />
              <Row k="JS heap" v={current.heap != null ? `${current.heap} MB` : "—"} />
            </Section>

            <Section title="Device">
              <Row k="Location" v={<span><Flag cc={current.cc} /> {current.country || "—"}</span>} />
              <Row k="OS" v={current.os || "—"} />
              <Row k="CPU" v={current.cpu || "—"} />
              <Row k="GPU" v={current.gpu || "—"} />
              <Row k="RAM" v={current.ram_gb ? `${current.ram_gb} GB` : "—"} />
              <Row k="Version" v={current.version || "—"} />
            </Section>

            <Link to={`/users/${encodeURIComponent(current.creator_id)}`} className="inline-block text-sm text-brand">
              Open full user profile →
            </Link>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-sub mb-1">{title}</div>
      <div className="card divide-y divide-line/60">{children}</div>
    </div>
  );
}
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 text-sm">
      <span className="text-sub">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}
