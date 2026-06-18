import { useCallback, useEffect, useState } from "react";
import { useStore, apiPost } from "../lib/store";
import { Card, Kpi, Empty } from "../components/ui";
import { fmtDateTime } from "../lib/format";

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending review", cls: "text-warn" },
  done: { label: "Erased", cls: "text-good" },
  rejected: { label: "Rejected", cls: "text-bad" },
};

export default function Admin() {
  const { stats, adminKey } = useStore();
  const s = stats!;
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!adminKey) {
      setRows(null);
      return;
    }
    const r = await fetch("/api/admin/deletions", { headers: { "X-Admin-Key": adminKey } });
    if (r.status === 401) {
      setErr("Invalid admin key.");
      setRows(null);
      return;
    }
    setErr("");
    const j = await r.json();
    setRows(j.deletions || []);
  }, [adminKey]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (packet_id: string, action: "approve" | "reject") => {
    await apiPost("/api/admin/decide", { packet_id, action }, adminKey);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Retention" value={`${s.privacy.retention_days}d`} sub="auto-purge" />
        <Kpi label="Erase delay" value={`${s.privacy.delete_delay_h}h`} sub="mandatory review" />
        <Kpi label="Pending deletions" value={s.privacy.pending_deletions} />
        <Kpi label="Total users" value={s.totals.users} />
      </div>

      <Card title="Deletion requests" right={<button onClick={load} className="text-xs text-brand">Refresh</button>}>
        {!adminKey ? (
          <Empty>Enter the admin key (top-right) to review deletion requests.</Empty>
        ) : err ? (
          <Empty>{err}</Empty>
        ) : rows == null ? (
          <Empty>Loading…</Empty>
        ) : rows.length ? (
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Packet</th>
                <th className="th">Requested</th>
                <th className="th">Auto-erase at</th>
                <th className="th">Status</th>
                <th className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const st = STATUS[d.status] || { label: d.status, cls: "text-sub" };
                return (
                  <tr key={d.packet_id}>
                    <td className="td font-mono text-[11px]">{d.packet_id}</td>
                    <td className="td text-sub">{fmtDateTime(d.requested_at)}</td>
                    <td className="td text-sub">{fmtDateTime(d.scheduled_at)}</td>
                    <td className={`td ${st.cls}`}>
                      {st.label}
                      {d.status === "done" && d.decided_at ? ` · ${fmtDateTime(d.decided_at)}` : ""}
                    </td>
                    <td className="td text-right">
                      {d.status === "pending" ? (
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => decide(d.packet_id, "approve")} className="pill bg-good/20 text-good hover:bg-good/30">Approve now</button>
                          <button onClick={() => decide(d.packet_id, "reject")} className="pill bg-bad/20 text-bad hover:bg-bad/30">Reject</button>
                        </div>
                      ) : (
                        <span className="text-sub text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Empty>No deletion requests.</Empty>
        )}
      </Card>
    </div>
  );
}
