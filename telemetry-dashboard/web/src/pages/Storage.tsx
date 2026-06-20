import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPost, apiDelete } from "../lib/store";
import { Card, Empty } from "../components/ui";
import { fmtDateTime, nf } from "../lib/format";

const fmtBytes = (b?: number) => {
  if (b == null || b === 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(Math.max(1, b)) / Math.log(1024));
  return `${(b / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
};

function downloadJson(obj: any, filename: string) {
  const blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const ACTION_LABEL: Record<string, string> = {
  replay_download: "Téléchargement replay",
  replay_delete: "Suppression replay",
  packet_delete: "Suppression paquet",
  backup_export: "Export backup",
  backup_import: "Import backup",
  deletion_decide: "Décision suppression",
};

function StorageLimitWidget({ usedBytes, limitMb, limitBytes, usedPct, barColor, onLoad }: {
  usedBytes: number; limitMb: number; limitBytes: number; usedPct: number; barColor: string; onLoad: () => void;
}) {
  const [inputMb, setInputMb] = useState(String(limitMb));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  // Sync input when server-side limitMb changes, but only when user isn't typing
  useEffect(() => { setInputMb(String(limitMb)); }, [limitMb]);

  const save = async () => {
    const mb = parseInt(inputMb, 10);
    if (!mb || mb < 128) { setMsg("Minimum 128 MB"); return; }
    setSaving(true); setMsg("");
    try {
      const r = await apiPost("/api/admin/storage-limit", { limit_mb: mb });
      if (r.status === 1) {
        setMsg(r.deleted_rows > 0 ? `✓ Limite mise à jour — ${r.deleted_rows.toLocaleString()} événements supprimés` : "✓ Limite mise à jour");
        onLoad();
      }
    } catch { setMsg("Erreur lors de la sauvegarde"); }
    finally { setSaving(false); }
  };

  return (
    <Card title="Limite de stockage">
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-sub">{fmtBytes(usedBytes)} utilisé</span>
          <span className={usedPct > 90 ? "text-bad font-semibold" : usedPct > 70 ? "text-warn" : "text-sub"}>{usedPct}% — limite {fmtBytes(limitBytes)}</span>
        </div>
        {/* Progress bar */}
        <div className="h-3 rounded-full bg-panel2 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${usedPct}%` }}
          />
        </div>
        {usedPct > 90 && (
          <div className="text-xs text-bad flex items-center gap-1">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>
            Stockage presque plein — les anciens événements seront supprimés automatiquement.
          </div>
        )}

        <div className="text-[11px] text-sub">
          Quand la limite est dépassée, les événements les plus anciens sont supprimés automatiquement toutes les heures.
          Minimum 128 MB. Défaut : 5 120 MB (5 GB).
        </div>
      </div>
    </Card>
  );
}



export default function Storage() {
  const [data, setData] = useState<any | null>(null);
  const [audit, setAudit] = useState<any[]>([]);
  const [busy, setBusy] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    apiGet("/api/admin/storage").then(setData).catch(() => setData({ tables: [], replays: [], packets: [] }));
    apiGet("/api/admin/audit").then((r) => setAudit(r.audit || [])).catch(() => setAudit([]));
  }, []);
  // Live: poll so size / counts / audit changes appear without a manual refresh.
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const exportBackup = async () => {
    setBusy("export");
    try {
      const dump = await apiGet("/api/admin/backup");
      downloadJson(dump, `bmm-telemetry-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`);
    } finally { setBusy(""); load(); }
  };

  const importBackup = async (file: File) => {
    setBusy("import");
    try {
      const text = await file.text();
      const doc = JSON.parse(text);
      const res = await apiPost("/api/admin/import", doc);
      const total = Object.values(res?.imported || {}).reduce((a: number, b: any) => a + (Number(b) || 0), 0);
      alert(`Import terminé — ${total} lignes ajoutées.`);
    } catch (e) {
      alert("Import échoué : " + e);
    } finally { setBusy(""); load(); }
  };

  const downloadReplay = async (sid: string) => {
    setBusy(`r-${sid}`);
    try {
      const r = await apiGet(`/api/admin/replay/download?session_id=${encodeURIComponent(sid)}`);
      downloadJson(r, `replay-${sid}.json`);
    } finally { setBusy(""); load(); }
  };
  const deleteReplay = async (sid: string) => {
    if (!confirm(`Supprimer le replay de la session ${sid} ?`)) return;
    setBusy(`r-${sid}`);
    try { await apiDelete(`/api/admin/replay?session_id=${encodeURIComponent(sid)}`); } finally { setBusy(""); load(); }
  };
  const deletePacket = async (pid: string) => {
    if (!confirm(`Effacer le paquet ${pid} et tous ses événements ?`)) return;
    setBusy(`p-${pid}`);
    try { await apiPost("/api/admin/packet/delete", { packet_id: pid }); } finally { setBusy(""); load(); }
  };

  if (!data) return <Empty>Chargement…</Empty>;
  const totalBytes = (data.tables || []).reduce((a: number, t: any) => a + (t.bytes || 0), 0);
  const usedBytes: number = data.storage_bytes ?? totalBytes;
  const limitMb: number = data.storage_limit_mb ?? 5120;
  const limitBytes = limitMb * 1024 * 1024;
  const usedPct = Math.min(100, Math.round(usedBytes / limitBytes * 100));
  const barColor = usedPct > 90 ? "bg-bad" : usedPct > 70 ? "bg-warn" : "bg-brand";

  return (
    <div className="space-y-4">
      {/* ── Storage overview ─────────────────────────────────────────────── */}
      <StorageLimitWidget usedBytes={usedBytes} limitMb={limitMb} limitBytes={limitBytes} usedPct={usedPct} barColor={barColor} onLoad={load} />
      <Card title={`Stockage · ${fmtBytes(usedBytes)} utilisé / ${fmtBytes(limitBytes)} limite`}>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2">
          {(data.tables || []).map((t: any) => (
            <div key={t.table} className="card px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-sub">{t.table}</div>
              <div className="text-lg font-semibold">{fmtBytes(t.bytes)}</div>
              <div className="text-[11px] text-sub">{nf(t.rows)} lignes</div>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Backup ───────────────────────────────────────────────────────── */}
      <Card title="Sauvegarde de la base">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={exportBackup} disabled={busy === "export"} className="pill bg-brand text-white">
            {busy === "export" ? "Export…" : "Exporter (JSON)"}
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={busy === "import"} className="pill bg-panel2">
            {busy === "import" ? "Import…" : "Importer un backup"}
          </button>
          <input
            ref={fileRef} type="file" accept="application/json" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importBackup(f); e.target.value = ""; }}
          />
          <span className="text-[11px] text-sub">L'import est additif (les clés existantes sont conservées). Chaque export / import est journalisé (IP + empreinte).</span>
        </div>
      </Card>

      {/* ── Replays ──────────────────────────────────────────────────────── */}
      <Card title={`Replays enregistrés · ${data.replays?.length || 0}`}>
        {data.replays?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className="th">Session</th><th className="th">Utilisateur</th>
                <th className="th text-right">Chunks</th><th className="th text-right">Taille</th>
                <th className="th text-right">Dernier</th><th className="th text-right">Actions</th>
              </tr></thead>
              <tbody>
                {data.replays.map((r: any) => (
                  <tr key={r.session_id} className="hover:bg-panel2">
                    <td className="td font-mono text-xs">{r.session_id}</td>
                    <td className="td font-mono text-xs text-sub">{r.distinct_id || "—"}</td>
                    <td className="td text-right">{nf(r.chunks)}</td>
                    <td className="td text-right">{fmtBytes(r.bytes)}</td>
                    <td className="td text-right text-sub">{fmtDateTime(r.last_ms)}</td>
                    <td className="td text-right whitespace-nowrap">
                      <button onClick={() => downloadReplay(r.session_id)} disabled={busy === `r-${r.session_id}`} className="pill bg-panel2 mr-1">Télécharger</button>
                      <button onClick={() => deleteReplay(r.session_id)} disabled={busy === `r-${r.session_id}`} className="pill bg-bad/20 text-bad">Supprimer</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>Aucun replay enregistré.</Empty>}
      </Card>

      {/* ── Packets ──────────────────────────────────────────────────────── */}
      <Card title={`Paquets de télémétrie · ${data.packets?.length || 0}`}>
        {data.packets?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className="th">Paquet</th><th className="th text-right">Événements</th>
                <th className="th text-right">Taille</th><th className="th text-right">Dernier</th><th className="th text-right">Actions</th>
              </tr></thead>
              <tbody>
                {data.packets.map((p: any) => (
                  <tr key={p.packet_id} className="hover:bg-panel2">
                    <td className="td font-mono text-xs">{p.packet_id}</td>
                    <td className="td text-right">{nf(p.events)}</td>
                    <td className="td text-right">{fmtBytes(p.bytes)}</td>
                    <td className="td text-right text-sub">{fmtDateTime(p.last_ms)}</td>
                    <td className="td text-right">
                      <button onClick={() => deletePacket(p.packet_id)} disabled={busy === `p-${p.packet_id}`} className="pill bg-bad/20 text-bad">Effacer</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>Aucun paquet.</Empty>}
      </Card>

      {/* ── Audit log ────────────────────────────────────────────────────── */}
      <Card title="Journal d'audit (qui a fait quoi)">
        {audit.length ? (
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className="th">Quand</th><th className="th">Action</th><th className="th">Cible</th>
                <th className="th">IP</th><th className="th">Empreinte</th>
              </tr></thead>
              <tbody>
                {audit.map((a: any) => (
                  <tr key={a.id} className="hover:bg-panel2">
                    <td className="td text-sub whitespace-nowrap">{fmtDateTime(a.at)}</td>
                    <td className="td">{ACTION_LABEL[a.action] || a.action}</td>
                    <td className="td font-mono text-xs">{a.target}</td>
                    <td className="td font-mono text-xs text-sub">{a.ip || "—"}</td>
                    <td className="td font-mono text-xs text-sub">{a.fp || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>Aucune action enregistrée.</Empty>}
      </Card>
    </div>
  );
}
