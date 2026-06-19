// Shared typed-event timeline used by Sessions and the user profile.
const ICON: Record<string, string> = {
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  cursor: "M5 3l6 18 2.5-7.5L21 11 5 3Z",
  external: "M14 3h7v7M21 3l-9 9M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5",
  copy: "M9 9h11v11H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",
  form: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  input: "M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2M9 20h6M12 4v16",
  alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  bolt: "M13 2 3 14h7l-1 8 10-12h-7l1-8Z",
};
export type TypeKey = "page" | "click" | "outbound" | "copy" | "form" | "input" | "error" | "event";
export const TYPES: Record<TypeKey, { label: string; color: string; icon: string }> = {
  page: { label: "Page vue", color: "#5b8cff", icon: ICON.eye },
  click: { label: "Clic sur bouton", color: "#37d399", icon: ICON.cursor },
  outbound: { label: "Sortant", color: "#22d3ee", icon: ICON.external },
  copy: { label: "Copier", color: "#a78bfa", icon: ICON.copy },
  form: { label: "Soumission de formulaire", color: "#f4b740", icon: ICON.form },
  input: { label: "Changement de saisie", color: "#e879f9", icon: ICON.input },
  error: { label: "Erreur", color: "#f06363", icon: ICON.alert },
  event: { label: "Événement", color: "#9aa3ad", icon: ICON.bolt },
};
// Friendly label for "generic" events so the timeline shows WHAT happened.
const EVENT_LABELS: Record<string, string> = {
  perf: "Performance",
  webvitals: "Web Vitals",
  session_start: "Début de session",
  session_end: "Fin de session",
  benchmark: "Benchmark",
  tutorial: "Tutoriel",
  feature: "Fonctionnalité",
  modal_open: "Modal",
  repo_connect: "Connexion repo",
  repo_host: "Hébergement repo",
  $identify: "Identification",
};
export function eventLabel(e: any): string {
  if (e.detail) return e.detail;
  return EVENT_LABELS[e.event] || e.event || "Événement";
}

// Turn a modal element id ("modal-conflict-warning", "apps-detail-modal") into a
// readable name. A captured title (from a modal_open event) always wins.
export function humanizeModal(id?: string | null, titles?: Record<string, string>): string {
  if (!id) return "";
  if (titles && titles[id]) return titles[id];
  return id
    .replace(/^modal-/, "").replace(/-(modal|overlay)$/g, "").replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

// Build a modal-id → human title map from the modal_open events in a session, so
// every later event that happened "in" that modal can show its real title.
export function buildModalTitles(events: any[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const e of events) {
    if (e.event === "modal_open" && e.name) {
      const title = (e.title || "").trim();
      if (title) m[e.name] = title;
    }
  }
  return m;
}

// "Where" an event happened: page › Modal. Returns "" for plain page views.
export function eventLocation(e: any, titles?: Record<string, string>): string {
  const view = e.view || "";
  const modal = humanizeModal(e.modal, titles);
  if (view && modal) return `${view} › ${modal}`;
  return modal || view;
}
export function classify(e: any): TypeKey {
  switch (e.event) {
    case "page_enter": return "page";
    case "click": return "click";
    case "outbound": return "outbound";
    case "copy": return "copy";
    case "form_submit": return "form";
    case "input_change": return "input";
    case "error": return "error";
    default: return "event";
  }
}
export function EvIcon({ type, size = 15 }: { type: TypeKey; size?: number }) {
  const t = TYPES[type];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={t.color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={t.icon} />
    </svg>
  );
}

// numbered, icon-prefixed event list (internal page_leave/perf filtered out).
// Each non-page action shows WHERE it happened (page › modal) underneath.
export function EventTimeline({ events, hidden }: { events: any[]; hidden?: Set<TypeKey> }) {
  const titles = buildModalTitles(events);
  const shown = events.filter((e) => e.event !== "page_leave" && e.event !== "perf" && !e.event?.startsWith("$log_") && (!hidden || !hidden.has(classify(e))));
  return (
    <ol className="space-y-1">
      {shown.map((e: any, i: number) => {
        const k = classify(e);
        const loc = k === "page" ? "" : eventLocation(e, titles);
        return (
          <li key={i} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-panel2">
            <span className="w-6 h-6 rounded-full bg-panel2 text-[11px] flex items-center justify-center shrink-0">{i + 1}</span>
            <EvIcon type={k} />
            <span className="text-sm flex-1 min-w-0">
              <span className="block truncate">
                {k === "page" ? <span className="font-medium">{e.view}</span> : <span>{eventLabel(e)}</span>}
                {k === "page" && e.dwell_ms ? <span className="text-sub text-xs"> · {Math.round(e.dwell_ms / 1000)}s</span> : null}
              </span>
              {loc ? (
                <span className="flex items-center gap-1 text-[11px] text-sub truncate">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z" /><circle cx="12" cy="10" r="2.5" />
                  </svg>
                  {loc}
                </span>
              ) : null}
            </span>
            <span className="text-sub text-[11px] shrink-0">{(e.ts || "").slice(11, 19)}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function TypeChips({ counts, hidden, onToggle }: { counts: Partial<Record<TypeKey, number>>; hidden: Set<TypeKey>; onToggle: (k: TypeKey) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {(Object.keys(TYPES) as TypeKey[]).filter((k) => counts[k]).map((k) => {
        const off = hidden.has(k);
        return (
          <button key={k} onClick={() => onToggle(k)} className={`pill border border-line ${off ? "text-sub opacity-50" : "text-ink"}`}>
            <EvIcon type={k} /> {TYPES[k].label} <span className="text-sub">{counts[k]}</span>
          </button>
        );
      })}
    </div>
  );
}
