import { useCallback, useEffect, useState } from "react";
import { useStore, apiPost, apiGet } from "../lib/store";
import { Card, Kpi, Empty } from "../components/ui";
import { fmtDateTime, nf } from "../lib/format";

const STATUS: Record<string, { label: string; cls: string }> = {
  pending:   { label: "Pending review", cls: "text-warn" },
  done:      { label: "Erased",         cls: "text-good" },
  rejected:  { label: "Rejected",       cls: "text-bad"  },
};

const fmtBytes = (b?: number) => {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(Math.max(1, b)) / Math.log(1024));
  return `${(b / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
};

// ── User Packet Search card ────────────────────────────────────────────────────
function UserPacketSearch({ adminKey }: { adminKey: string }) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [packets, setPackets] = useState<any[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  const search = async () => {
    if (!q.trim()) return;
    setLoading(true); setPackets(null); setMsg(""); setSel(new Set());
    try {
      const r = await apiGet(`/api/admin/user-packets?q=${encodeURIComponent(q.trim())}`);
      setPackets(r.packets || []);
    } catch { setMsg("Erreur de recherche"); }
    finally { setLoading(false); }
  };

  const toggle = (pid: string) =>
    setSel(s => { const n = new Set(s); n.has(pid) ? n.delete(pid) : n.add(pid); return n; });
  const toggleAll = () =>
    setSel(sel.size === (packets?.length || 0) ? new Set() : new Set((packets || []).map((p: any) => p.packet_id)));

  const deleteSelected = async () => {
    if (!sel.size) return;
    if (!confirm(`Supprimer définitivement ${sel.size} paquet(s) et tous leurs événements ?`)) return;
    setBusy("delete"); setMsg("");
    try {
      const r = await apiPost("/api/admin/user-packets/delete", { packet_ids: [...sel] }, adminKey);
      setMsg(`✓ ${r.deleted_events ?? 0} événements supprimés`);
      setSel(new Set());
      search();
    } catch { setMsg("Erreur lors de la suppression"); }
    finally { setBusy(""); }
  };

  const downloadSelected = () => {
    if (!sel.size) return;
    const ids = [...sel].join(",");
    const url = `/api/admin/user-packets/download?packet_ids=${encodeURIComponent(ids)}&admin_key=${encodeURIComponent(adminKey)}`;
    const a = document.createElement("a");
    a.href = url; a.download = `packets-${Date.now()}.json`; a.click();
    setMsg(`↓ Téléchargement de ${sel.size} paquet(s)…`);
  };

  return (
    <Card title="Recherche de paquets par utilisateur">
      <div className="space-y-3">
        <div className="text-[11px] text-sub mb-1">
          Recherche par <code className="font-mono bg-panel2 px-1 rounded">creator_id</code> exact ou préfixe de <code className="font-mono bg-panel2 px-1 rounded">packet_id</code>.
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => e.key === "Enter" && search()}
            placeholder="creator_id ou packet_id…"
            className="flex-1 min-w-48 bg-panel2 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand font-mono"
          />
          <button onClick={search} disabled={loading || !q.trim()} className="pill bg-brand text-white px-4 py-2 text-xs">
            {loading ? "Recherche…" : "Chercher"}
          </button>
        </div>

        {packets !== null && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-sub">{packets.length} paquet(s) trouvé(s)</span>
              {packets.length > 0 && (
                <>
                  <button onClick={toggleAll} className="pill bg-panel2 text-xs">
                    {sel.size === packets.length ? "Tout désélectionner" : "Tout sélectionner"}
                  </button>
                  {sel.size > 0 && (
                    <>
                      <button onClick={downloadSelected} disabled={!!busy} className="pill bg-panel2 text-xs">
                        ↓ Télécharger ({sel.size})
                      </button>
                      <button onClick={deleteSelected} disabled={!!busy} className="pill bg-bad/20 text-bad text-xs">
                        {busy === "delete" ? "Suppression…" : `🗑 Supprimer (${sel.size})`}
                      </button>
                    </>
                  )}
                </>
              )}
              {msg && <span className={`text-xs ${msg.startsWith("✓") || msg.startsWith("↓") ? "text-good" : "text-bad"}`}>{msg}</span>}
            </div>

            {packets.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr>
                    <th className="th w-6">
                      <input type="checkbox" checked={sel.size === packets.length && packets.length > 0} onChange={toggleAll} className="accent-brand" />
                    </th>
                    <th className="th">Packet ID</th>
                    <th className="th">Creator</th>
                    <th className="th text-right">Événements</th>
                    <th className="th text-right">Taille</th>
                    <th className="th">Premier</th>
                    <th className="th">Dernier</th>
                    <th className="th">Statut</th>
                  </tr></thead>
                  <tbody>
                    {packets.map((p: any) => {
                      const del = p.deletion;
                      const isAutoPurge = del?.decided_by === "auto_purge";
                      const st = del
                        ? (isAutoPurge ? { label: "Auto-purgé", cls: "text-sub" } : (STATUS[del.status] || { label: del.status, cls: "text-sub" }))
                        : { label: "Présent", cls: "text-good" };
                      return (
                        <tr key={p.packet_id} className={`hover:bg-panel2 ${sel.has(p.packet_id) ? "bg-brand/5" : ""}`}>
                          <td className="td">
                            <input type="checkbox" checked={sel.has(p.packet_id)} onChange={() => toggle(p.packet_id)} className="accent-brand" />
                          </td>
                          <td className="td font-mono text-[11px] max-w-[12rem] truncate" title={p.packet_id}>{p.packet_id || "—"}</td>
                          <td className="td font-mono text-xs text-sub max-w-[10rem] truncate" title={p.distinct_id}>{p.distinct_id || "—"}</td>
                          <td className="td text-right">{nf(p.events)}</td>
                          <td className="td text-right">{fmtBytes(p.bytes)}</td>
                          <td className="td text-sub text-xs whitespace-nowrap">{fmtDateTime(p.first_event)}</td>
                          <td className="td text-sub text-xs whitespace-nowrap">{fmtDateTime(p.last_event)}</td>
                          <td className={`td text-xs font-medium ${st.cls}`}>{st.label}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>Aucun paquet trouvé pour « {q} ».</Empty>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

// ── Main Admin page ────────────────────────────────────────────────────────────
export default function Admin() {
  const { stats, adminKey } = useStore();
  const s = stats!;
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!adminKey) { setRows(null); return; }
    const r = await fetch("/api/admin/deletions", { headers: { "X-Admin-Key": adminKey } });
    if (r.status === 401) { setErr("Invalid admin key."); setRows(null); return; }
    setErr("");
    const j = await r.json();
    setRows(j.deletions || []);
  }, [adminKey]);

  useEffect(() => { load(); }, [load]);

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



      {/* ── Deletion requests ────────────────────────────────────────────── */}
      <Card title="Deletion requests" right={<button onClick={load} className="text-xs text-brand">Refresh</button>}>
        {!adminKey ? (
          <Empty>Enter the admin key (top-right) to review deletion requests.</Empty>
        ) : err ? (
          <Empty>{err}</Empty>
        ) : rows == null ? (
          <Empty>Loading…</Empty>
        ) : rows.length ? (
          <div className="overflow-x-auto">
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
                  const isAutoPurge = d.decided_by === "auto_purge";
                  const st = isAutoPurge
                    ? { label: "Auto-purgé (limite stockage)", cls: "text-sub" }
                    : (STATUS[d.status] || { label: d.status, cls: "text-sub" });
                  return (
                    <tr key={d.packet_id}>
                      <td className="td font-mono text-[11px]">{d.packet_id}</td>
                      <td className="td text-sub">{fmtDateTime(d.requested_at)}</td>
                      <td className="td text-sub">{isAutoPurge ? "—" : fmtDateTime(d.scheduled_at)}</td>
                      <td className={`td ${st.cls}`}>
                        {st.label}
                        {d.status === "done" && d.decided_at && !isAutoPurge ? ` · ${fmtDateTime(d.decided_at)}` : ""}
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
          </div>
        ) : (
          <Empty>No deletion requests.</Empty>
        )}
      </Card>
    </div>
  );
}
