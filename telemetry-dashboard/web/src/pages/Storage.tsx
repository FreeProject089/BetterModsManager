import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPost, apiDelete } from "../lib/store";
import { Card, Empty } from "../components/ui";
import { fmtDateTime, nf } from "../lib/format";

const fmtBytes = (b?: number) => {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(b) / Math.log(1024));
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

export default function Storage() {
  const [data, setData] = useState<any | null>(null);
  const [audit, setAudit] = useState<any[]>([]);
  const [busy, setBusy] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    apiGet("/api/admin/storage").then(setData).catch(() => setData({ tables: [], replays: [], packets: [] }));
    apiGet("/api/admin/audit").then((r) => setAudit(r.audit || [])).catch(() => setAudit([]));
  }, []);
  useEffect(() => { load(); }, [load]);

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

  return (
    <div className="space-y-4">
      {/* ── Storage overview ─────────────────────────────────────────────── */}
      <Card title={`Stockage · ${fmtBytes(totalBytes)} au total`}>
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
