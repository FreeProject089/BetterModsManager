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

/**
 * Load a stylesheet once, the way `loadVendorScript` loads a script.
 *
 * KaTeX needs its CSS: without it every formula renders as a stack of overlapping glyphs,
 * which is worse than the dollar signs it replaced.
 */
export function loadVendorCss(href: string): Promise<void> {
    const cached = loads.get(href);
    if (cached) return cached;
    const p = new Promise<void>((resolve, reject) => {
        const existing = document.querySelector<HTMLLinkElement>(`link[href="${href}"]`);
        if (existing?.dataset.loaded === '1') { resolve(); return; }
        const el = existing ?? document.createElement('link');
        el.rel = 'stylesheet';
        el.addEventListener('load', () => { el.dataset.loaded = '1'; resolve(); }, { once: true });
        el.addEventListener('error', () => reject(new Error(`css ${href}`)), { once: true });
        if (!existing) { el.href = href; document.head.appendChild(el); }
    });
    p.catch(() => loads.delete(href));
    loads.set(href, p);
    return p;
}

/**
 * Load KaTeX, for a document that has maths in it.
 *
 * Both halves together: the script alone typesets into markup the stylesheet is what makes
 * legible, so resolving before the CSS has landed would show one frame of overlapping glyphs
 * on every formula.
 */
export async function ensureKatex(): Promise<any> {
    await Promise.all([
        loadVendorScript('assets/vendor/katex/katex.min.js'),
        loadVendorCss('assets/vendor/katex/katex.min.css'),
    ]);
    return (globalThis as any).katex || null;
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
