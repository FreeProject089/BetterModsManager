import { ReactNode } from "react";

export function Card({ title, right, children, className = "" }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`card p-4 ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between mb-3">
          {title && <h3 className="text-sm font-semibold text-ink">{title}</h3>}
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

export function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="kpi">
      <div className="text-[11px] uppercase tracking-wide text-sub">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-xs text-sub mt-0.5">{sub}</div>}
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  online: "bg-good",
  away: "bg-warn",
  crashed: "bg-bad",
  offline: "bg-sub",
};
export function StatusDot({ status }: { status: string }) {
  return <span className={`inline-block w-2 h-2 rounded-full ${STATUS_COLOR[status] || "bg-sub"}`} />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="text-sm text-sub py-8 text-center">{children}</div>;
}

// Slide-over drawer. Its open state lives in the page, so live data refreshes
// never close it.
export function Drawer({ open, onClose, title, children, width = 560 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: number }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full bg-panel border-l border-line overflow-y-auto" style={{ width }}>
        <div className="sticky top-0 bg-panel/95 backdrop-blur border-b border-line px-4 py-3 flex items-center justify-between">
          <div className="font-semibold text-sm">{title}</div>
          <button onClick={onClose} className="text-sub hover:text-ink px-2" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Bar({ pct, color = "bg-brand" }: { pct: number; color?: string }) {
  return (
    <div className="h-2 rounded bg-panel2 overflow-hidden">
      <div className={`h-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}
