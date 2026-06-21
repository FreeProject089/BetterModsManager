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

// Collapsible card with an optional search box (used for every data zone).
function Section({ title, count, open, onToggle, search, onSearch, searchPh, children }: {
  title: string; count: number; open: boolean; onToggle: () => void;
  search?: string; onSearch?: (v: string) => void; searchPh?: string; children: React.ReactNode;
}) {
  return (
    <Card title={`${title} · ${count}`} right={
      <div className="flex items-center gap-2">
        {open && onSearch !== undefined && (
          <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder={searchPh || "Rechercher…"}
            className="bg-panel2 border border-line rounded-lg px-2.5 py-1 text-xs w-44 focus:outline-none focus:border-brand" />
        )}
        <button onClick={onToggle} className="text-sub hover:text-ink p-1" title={open ? "Réduire" : "Déplier"}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            style={{ transform: open ? "" : "rotate(-90deg)", transition: "transform .15s" }}><polyline points="6 9 12 15 18 9" /></svg>
        </button>
      </div>
    }>
      {open && children}
    </Card>
  );
}

// Lightweight recap viewer (the "Analyser" button).
function RecapView({ recap, onClose }: { recap: any; onClose: () => void }) {
  const t = recap?.totals || {};
  const list = (arr: any[]) => (arr || []).slice(0, 12).map((x: any) => (
    <div key={x.k} className="flex justify-between gap-3 text-sm py-0.5"><span className="truncate">{x.k || "—"}</span><span className="text-sub">{nf(x.v)}</span></div>
  ));
  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/55 p-4" onClick={onClose}>
      <div className="w-[min(820px,95vw)] max-h-[88vh] overflow-auto bg-panel border border-line rounded-2xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="font-semibold">Recap · {recap?.month || "?"} {recap?.anonymized ? "· anonymisé" : ""}</div>
          <button onClick={onClose} className="pill bg-panel2">Fermer</button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
          {[["Events", t.events], ["Sessions", t.sessions], ["Pages vues", t.pageviews], ["Users", t.users], ["Min/session", t.avg_session_min], ["Pages/session", t.pages_per_session]].map(([k, v]) => (
            <div key={k as string} className="card px-3 py-2"><div className="text-[11px] uppercase tracking-wide text-sub">{k}</div><div className="text-lg font-semibold">{nf(Number(v) || 0)}</div></div>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card title="Top events">{recap?.top_events?.length ? list(recap.top_events) : <Empty>—</Empty>}</Card>
          <Card title="Top pages">{recap?.top_pages?.length ? list(recap.top_pages) : <Empty>—</Empty>}</Card>
        </div>
        {recap?.os?.length ? <Card title="OS">{list(recap.os)}</Card> : null}
      </div>
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = {
  replay_download: "Téléchargement replay",
  replay_delete: "Suppression replay",
  packet_delete: "Suppression paquet",
  backup_export: "Export backup",
  backup_import: "Import backup",
  deletion_decide: "Décision suppression",
  storage_limit: "Limite de stockage",
  recap_export: "Export / génération recap",
  recap_import: "Import recap",
  recap_delete: "Suppression recap",
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
  const recapFileRef = useRef<HTMLInputElement>(null);
  const [recaps, setRecaps] = useState<any[]>([]);
  const [recapMonth, setRecapMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [recapAnon, setRecapAnon] = useState(false);

  const [dataReqs, setDataReqs] = useState<any[]>([]);
  const load = useCallback(() => {
    apiGet("/api/admin/storage").then(setData).catch(() => setData({ tables: [], replays: [], packets: [] }));
    apiGet("/api/admin/audit").then((r) => setAudit(r.audit || [])).catch(() => setAudit([]));
    apiGet("/api/admin/recaps").then((r) => setRecaps(r.recaps || [])).catch(() => setRecaps([]));
    apiGet("/api/admin/data-requests").then((r) => setDataReqs(Array.isArray(r) ? r : [])).catch(() => setDataReqs([]));
  }, []);
  const decideDataReq = async (id: number, status: string) => {
    try { await apiPost("/api/admin/data-request/decide", { id, status }); } catch { /* */ }
    load();
  };

  const generateRecap = async () => {
    setBusy("recap");
    try {
      const r = await apiGet(`/api/admin/recap?month=${encodeURIComponent(recapMonth)}&anon=${recapAnon ? 1 : 0}`);
      if (r?.recap) downloadJson(r.recap, `bmm-recap-${recapMonth}${recapAnon ? "-anon" : ""}.json`);
    } finally { setBusy(""); load(); }
  };
  const importRecap = async (file: File) => {
    setBusy("recap-import");
    try { await apiPost("/api/admin/recap/import", JSON.parse(await file.text())); }
    catch (e) { alert("Import échoué : " + e); }
    finally { setBusy(""); load(); }
  };
  const downloadRecap = async (id: number, month: string) => {
    const r = await apiGet(`/api/admin/recap/get?id=${id}`);
    downloadJson(r, `bmm-recap-${month || id}.json`);
  };
  const deleteRecap = async (id: number) => {
    if (!confirm("Supprimer ce recap ?")) return;
    await apiDelete(`/api/admin/recap?id=${id}`); load();
  };
  const analyzeRecap = async (id: number) => {
    try { setRecapView(await apiGet(`/api/admin/recap/get?id=${id}`)); } catch { /* ignore */ }
  };

  // Collapse + per-section search state.
  const [open, setOpen] = useState<Record<string, boolean>>({ replays: true, packets: true, audit: true, recaps: true });
  const [q, setQ] = useState<Record<string, string>>({});
  const [recapView, setRecapView] = useState<any | null>(null);
  const tog = (k: string) => setOpen((o) => ({ ...o, [k]: !(o[k] ?? true) }));
  const qv = (k: string) => q[k] || "";
  const sq = (k: string, v: string) => setQ((s) => ({ ...s, [k]: v }));
  const has = (hay: any, needle: string) => String(hay ?? "").toLowerCase().includes(needle.toLowerCase());
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
      <Section title="Replays enregistrés" count={data.replays?.length || 0} open={open.replays !== false}
        onToggle={() => tog("replays")} search={qv("replays")} onSearch={(v) => sq("replays", v)} searchPh="session / user…">
        {(() => { const rows = (data.replays || []).filter((r: any) => !qv("replays") || has(r.session_id, qv("replays")) || has(r.distinct_id, qv("replays"))); return rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className="th">Session</th><th className="th">Utilisateur</th>
                <th className="th text-right">Chunks</th><th className="th text-right">Taille</th>
                <th className="th text-right">Dernier</th><th className="th text-right">Actions</th>
              </tr></thead>
              <tbody>
                {rows.map((r: any) => (
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
        ) : <Empty>Aucun replay.</Empty>; })()}
      </Section>

      {/* ── Packets ──────────────────────────────────────────────────────── */}
      <Section title="Paquets de télémétrie" count={data.packets?.length || 0} open={open.packets !== false}
        onToggle={() => tog("packets")} search={qv("packets")} onSearch={(v) => sq("packets", v)} searchPh="id de paquet…">
        {(() => { const rows = (data.packets || []).filter((p: any) => !qv("packets") || has(p.packet_id, qv("packets"))); return rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className="th">Paquet</th><th className="th text-right">Événements</th>
                <th className="th text-right">Taille</th><th className="th text-right">Dernier</th><th className="th text-right">Actions</th>
              </tr></thead>
              <tbody>
                {rows.map((p: any) => (
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
        ) : <Empty>Aucun paquet.</Empty>; })()}
      </Section>

      {/* ── Monthly recaps ───────────────────────────────────────────────── */}
      <Section title="Recaps mensuels" count={recaps.length} open={open.recaps !== false}
        onToggle={() => tog("recaps")} search={qv("recaps")} onSearch={(v) => sq("recaps", v)} searchPh="mois / source…">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input type="month" value={recapMonth} onChange={(e) => setRecapMonth(e.target.value)}
            className="bg-panel2 border border-line rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-brand" />
          <label className="flex items-center gap-1.5 text-xs text-sub cursor-pointer">
            <input type="checkbox" checked={recapAnon} onChange={(e) => setRecapAnon(e.target.checked)} /> Anonymiser
          </label>
          <button onClick={generateRecap} disabled={busy === "recap"} className="pill bg-brand text-white">
            {busy === "recap" ? "Génération…" : "Générer & télécharger"}
          </button>
          <button onClick={() => recapFileRef.current?.click()} disabled={busy === "recap-import"} className="pill bg-panel2">
            {busy === "recap-import" ? "Import…" : "Importer un recap"}
          </button>
          <input ref={recapFileRef} type="file" accept="application/json" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importRecap(f); e.target.value = ""; }} />
          <span className="text-[11px] text-sub">Léger, à la demande. Non-anonyme par défaut. Chaque export / import est journalisé.</span>
        </div>
        {(() => { const rows = recaps.filter((r: any) => !qv("recaps") || has(r.month, qv("recaps")) || has(r.source, qv("recaps"))); return rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">Mois</th><th className="th">Source</th><th className="th">Anon</th><th className="th">Créé</th><th className="th text-right">Actions</th></tr></thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.id} className="hover:bg-panel2">
                    <td className="td font-mono text-xs">{r.month || "—"}</td>
                    <td className="td text-sub">{r.source}</td>
                    <td className="td">{r.anon ? "oui" : "non"}</td>
                    <td className="td text-sub">{fmtDateTime(r.created_at)}</td>
                    <td className="td text-right whitespace-nowrap">
                      <button onClick={() => analyzeRecap(r.id)} className="pill bg-brand text-white mr-1">Analyser</button>
                      <button onClick={() => downloadRecap(r.id, r.month)} className="pill bg-panel2 mr-1">Télécharger</button>
                      <button onClick={() => deleteRecap(r.id)} className="pill bg-bad/20 text-bad">Suppr.</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>Aucun recap. Génère-en un ci-dessus.</Empty>; })()}
      </Section>

      {/* ── Audit log ────────────────────────────────────────────────────── */}
      <Section title="Journal d'audit (qui a fait quoi)" count={audit.length} open={open.audit !== false}
        onToggle={() => tog("audit")} search={qv("audit")} onSearch={(v) => sq("audit", v)} searchPh="action / cible / IP…">
        {(() => { const rows = audit.filter((a: any) => !qv("audit") || has(a.action, qv("audit")) || has(a.target, qv("audit")) || has(a.ip, qv("audit")) || has(a.fp, qv("audit"))); return rows.length ? (
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className="th">Quand</th><th className="th">Action</th><th className="th">Cible</th>
                <th className="th">IP</th><th className="th">Empreinte</th>
              </tr></thead>
              <tbody>
                {rows.map((a: any) => (
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
        ) : <Empty>Aucune action enregistrée.</Empty>; })()}
      </Section>

      {/* ── GDPR data-access requests (review + e-mail the export manually) ── */}
      <Card title={`Demandes d'accès aux données · ${dataReqs.filter((r) => r.status === "pending").length}`}>
        {dataReqs.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className="th">Créé</th><th className="th">E-mail</th><th className="th">Creator ID</th>
                <th className="th">État</th><th className="th text-right">Actions</th>
              </tr></thead>
              <tbody>
                {dataReqs.map((r: any) => (
                  <tr key={r.id} className="hover:bg-panel2">
                    <td className="td text-sub whitespace-nowrap">{fmtDateTime(r.created_ms)}</td>
                    <td className="td font-mono text-xs">{r.email}</td>
                    <td className="td font-mono text-xs text-sub" title={r.creator_id}>{(r.creator_id || "").slice(0, 16)}…</td>
                    <td className="td">{r.status === "pending"
                      ? <span className="pill bg-brand/20 text-brand">en attente</span>
                      : r.status === "done"
                        ? <span className="pill bg-good/20 text-good">traité</span>
                        : <span className="pill bg-bad/20 text-bad">rejeté</span>}</td>
                    <td className="td text-right whitespace-nowrap">
                      {r.status === "pending" && <>
                        <button onClick={() => decideDataReq(r.id, "done")} className="pill bg-good/20 text-good mr-1">Marquer envoyé</button>
                        <button onClick={() => decideDataReq(r.id, "rejected")} className="pill bg-bad/20 text-bad">Rejeter</button>
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>Aucune demande d'accès.</Empty>}
      </Card>

      {recapView && <RecapView recap={recapView} onClose={() => setRecapView(null)} />}
    </div>
  );
}
