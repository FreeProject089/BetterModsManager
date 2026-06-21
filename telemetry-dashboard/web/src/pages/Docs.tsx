import { useMemo, useState } from "react";
import { useStats } from "../lib/store";
import { Card, Empty } from "../components/ui";

// "Where is it?" — inferred from the destination id, so it's automatic (no
// per-item maintenance). Pure prefix/keyword classifier over BMM's id scheme.
function sectionOf(id: string): string {
  const s = id.toLowerCase();
  if (/repo/.test(s)) return "Server Repo";
  if (/conflict|integrity|stack|activation|duplicate-folder/.test(s)) return "Library · Conflicts";
  if (/profile/.test(s)) return "Profiles";
  if (/mapper/.test(s)) return "Mapper";
  if (/modpack|launchpack/.test(s)) return "Modpacks";
  if (/apps|app-picker|app-modal|cr-app/.test(s)) return "App Catalog";
  if (/plugin|(^|-)api/.test(s)) return "Plugins & API";
  if (/scheduler|monitoring|whitelist|bans/.test(s)) return "Scheduling / Hosting";
  if (/theme/.test(s)) return "Settings · Themes";
  if (/security|privacy|tos|license|lang|update-notes|crash|betahub|i18n|storage|security-choice|ptb/.test(s)) return "Settings / System";
  if (/contributor|credits|tutorial/.test(s)) return "Credits & Tutorial";
  if (/docs|diagram/.test(s)) return "Documentation";
  if (/history/.test(s)) return "History";
  if (/benchmark|perf|advanced-perf/.test(s)) return "Performance";
  if (/(^|-)mod(-|$)|add-mod|mod-tags|delete-mod|mod-stack/.test(s)) return "Library";
  return "Other";
}

// Page labels can carry a trailing badge count ("Library 9") — strip it.
function stripCounts(labels: Record<string, string>, ids: string[]): Record<string, string> {
  const out: Record<string, string> = { ...labels };
  for (const id of ids) if (out[id]) out[id] = out[id].replace(/\s*\d+$/, "").trim();
  return out;
}

function humanize(id: string): string {
  return id.replace(/^modal-/, "").replace(/-(modal|overlay)$/g, "").replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

function Group({ title, items, labels, q, withSection }: { title: string; items: string[]; labels: Record<string, string>; q: string; withSection?: boolean }) {
  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return items
      .map((id) => ({ id, label: labels[id] || humanize(id), section: sectionOf(id) }))
      .filter((r) => !ql || r.id.toLowerCase().includes(ql) || r.label.toLowerCase().includes(ql) || r.section.toLowerCase().includes(ql))
      .sort((a, b) => (withSection ? a.section.localeCompare(b.section) || a.label.localeCompare(b.label) : a.label.localeCompare(b.label)));
  }, [items, labels, q, withSection]);

  if (!rows.length) return null;
  return (
    <Card title={`${title} · ${rows.length}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Nom</th>
              <th className="th">Identifiant</th>
              {withSection && <th className="th">Où</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-panel2">
                <td className="td">{r.label}</td>
                <td className="td font-mono text-xs text-sub">{r.id}</td>
                {withSection && <td className="td"><span className="pill bg-panel2 text-xs">{r.section}</span></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function Docs() {
  const s = useStats()!;
  const cat: any = (s as any).catalog || {};
  const labels: Record<string, string> = cat.labels || {};
  const [q, setQ] = useState("");

  const total = (cat.pages?.length || 0) + (cat.tabs?.length || 0) + (cat.modals?.length || 0) + (cat.diagrams?.length || 0) + (cat.guides?.length || 0);

  if (!total) {
    return <Empty>Le catalogue n'est pas encore arrivé. Il est rempli automatiquement dès qu'un client BMM (avec consentement télémétrie) envoie son catalogue.</Empty>;
  }

  return (
    <div className="space-y-4">
      <Card title="Documentation — où se trouve quoi dans BMM">
        <p className="text-xs text-sub mb-3">
          Chaque page, onglet, modal, diagramme et guide que BMM expose, listé automatiquement (les clients BMM
          envoient leur propre catalogue). Le nom vient de l'app ; la colonne « Où » est déduite de l'identifiant.
        </p>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher une page, un modal, un onglet…"
          className="w-full bg-panel2 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand"
        />
        <div className="text-[11px] text-sub mt-2">{total} destinations cataloguées</div>
      </Card>

      <Group title="Pages" items={cat.pages || []} labels={stripCounts(labels, cat.pages || [])} q={q} />
      <Group title="Onglets & sous-navigation" items={cat.tabs || []} labels={labels} q={q} withSection />
      <Group title="Modals & dialogues" items={cat.modals || []} labels={labels} q={q} withSection />
      <Group title="Diagrammes (docs)" items={cat.diagrams || []} labels={labels} q={q} />
      <Group title="Guides (.md)" items={cat.guides || []} labels={labels} q={q} />
    </div>
  );
}
