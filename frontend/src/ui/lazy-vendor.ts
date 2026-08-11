// Vendored libraries that only one screen needs, loaded the first time that screen asks.
//
// They used to be plain <script> tags in index.html, which means every launch parsed them
// before the window could paint. mermaid alone is 3.3 MB — 92% of all the JavaScript BMM
// shipped at boot — and nothing outside the diagram viewer and the docs hub has ever
// touched it. Same for svg-pan-zoom, which exists to drag those diagrams around.
//
// Loading them here costs a short wait the first time a diagram opens, and nothing after:
// the promise is cached, so ten diagrams share one load. Everything else in the app starts
// that much sooner.

/** In-flight or settled loads, keyed by src — a second caller waits on the first. */
const loads = new Map<string, Promise<void>>();

/**
 * Inject a classic (non-module) script once and resolve when it has run.
 *
 * Rejects on load failure rather than hanging, so a caller can fall back to showing
 * something rather than an empty box that never fills in.
 */
export function loadVendorScript(src: string): Promise<void> {
    const cached = loads.get(src);
    if (cached) return cached;

    const p = new Promise<void>((resolve, reject) => {
        // A tag may already be in the page (a leftover in index.html, or a previous build).
        // Adopting it is not enough — it may already have run, in which case there is no
        // further load event to wait for, so check for that first.
        const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
        if (existing?.dataset.loaded === '1') { resolve(); return; }

        const el = existing ?? document.createElement('script');
        el.addEventListener('load', () => { el.dataset.loaded = '1'; resolve(); }, { once: true });
        el.addEventListener('error', () => reject(new Error(`could not load ${src}`)), { once: true });
        if (!existing) {
            el.src = src;
            document.head.appendChild(el);
        }
    });
    // A failed load is not cached: opening the viewer again should retry rather than
    // report the same failure forever.
    p.catch(() => loads.delete(src));
    loads.set(src, p);
    return p;
}

/** True once mermaid has been configured, so the palette is only applied once per load. */
let mermaidReady = false;

/**
 * Load mermaid and apply the diagram viewer's palette.
 *
 * The docs hub re-initialises from the live theme tokens before every page, so this
 * configuration is only what an interactive diagram opens with.
 */
export async function ensureMermaid(): Promise<any> {
    await loadVendorScript('assets/vendor/mermaid.min.js');
    const m = (globalThis as any).mermaid;
    if (m && !mermaidReady) {
        mermaidReady = true;
        m.initialize({
            startOnLoad: false,
            theme: 'base',
            useMaxWidth: false,
            htmlLabels: true,           // Enable HTML labels for icons
            securityLevel: 'loose',     // Required for HTML labels
            flowchart: {
                clusterPadding: 65,     // Space for labels at the top without overlap
                nodeSpacing: 50,
                rankSpacing: 50,
                curve: 'basis',
            },
            themeVariables: {
                primaryColor: '#3b82f6',
                primaryTextColor: '#f1f5f9',
                primaryBorderColor: '#3b82f6',
                lineColor: '#475569',
                fontFamily: 'Inter, sans-serif',
                fontSize: '14px',
                mainBkg: '#1e293b',
            },
        });
    }
    return m;
}

/** Load svg-pan-zoom — only the interactive diagram viewer drags an SVG around. */
export async function ensureSvgPanZoom(): Promise<any> {
    await loadVendorScript('assets/vendor/svg-pan-zoom.min.js');
    return (globalThis as any).svgPanZoom;
}
