export const fmtDate = (s?: string | number | null) => {
  if (!s) return "—";
  const d = typeof s === "number" ? new Date(s) : new Date(s);
  if (isNaN(d.getTime())) return String(s);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};
export const fmtDateTime = (s?: string | number | null) => {
  if (!s) return "—";
  const d = typeof s === "number" ? new Date(s) : new Date(s);
  if (isNaN(d.getTime())) return String(s);
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};
export const ago = (sec?: number) => {
  if (sec == null) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
};
export const dur = (sec?: number) => {
  if (!sec) return "0s";
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m < 60) return `${m}m ${s}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};
export const nf = (n?: number) => (n == null ? "—" : new Intl.NumberFormat().format(n));

// web-vitals thresholds → color class
export const vitalClass = (metric: string, v?: number) => {
  if (v == null) return "text-sub";
  const t: Record<string, [number, number]> = {
    lcp: [2.5, 4],
    fcp: [1.8, 3],
    inp: [200, 500],
    cls: [0.1, 0.25],
    ttfb: [800, 1800],
  };
  const th = t[metric];
  if (!th) return "text-ink";
  if (v <= th[0]) return "text-good";
  if (v <= th[1]) return "text-warn";
  return "text-bad";
};
