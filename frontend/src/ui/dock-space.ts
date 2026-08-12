// dock-space.ts — ONE owner for the space docked side panels reserve, and the one
// place that decides whether there is room for them at all.
//
// Three panels can dock to the right edge (the tutorial, the theme editor, the
// translation sandbox). Each used to write `.app-shell` style.paddingRight
// directly: docking a second one overwrote the first's reservation, and undocking
// either cleared the padding the still-docked panel depended on — leaving it
// painting over live app content.
//
// The reservation is now a function of ALL open docks (each names itself, the
// widest wins since they stack at the same edge, releasing one recomputes from
// whoever is left) AND it is CLAMPED so the app always keeps a usable band.
//
// The rule the field asked for: a dock never covers content. If the window is too
// narrow to give a panel its width and still leave the app room, the panel gets
// less — and if even its minimum does not fit, it gets nothing and the caller is
// told to stay floating. Covering the app is never the outcome.

/** Below this, the app's own layout stops working (the sidebar alone is ~160px,
 *  and the mod list needs room for a name, a version and a path). A dock that
 *  would push the app under this is refused rather than granted. */
const MIN_APP_W = 700;

/** A dock narrower than this is not a panel, it is a sliver — better to stay
 *  floating than to hand back something unusable. */
const MIN_DOCK_W = 300;

// Each claim keeps BOTH numbers: what the panel asked for and what it was given.
// Storing only the granted width made re-fitting lossy — a window dragged narrow
// clamped the claim, and dragging it wide again re-fitted the *clamped* value, so
// the space was never handed back. The request is the panel's preference and must
// survive the squeeze.
interface Claim { want: number; got: number; }
const _claims = new Map<string, Claim>();

/** How much of `requested` this window can actually spare. 0 means "no room —
 *  do not dock". Exported so a caller can ask BEFORE committing to dock mode. */
export function fitDockWidth(requested: number): number {
    const avail = window.innerWidth - MIN_APP_W;
    if (avail < MIN_DOCK_W) return 0;              // nothing worth docking into
    return Math.max(MIN_DOCK_W, Math.min(requested, avail));
}

function _apply(): void {
    const width = _claims.size ? Math.max(...Array.from(_claims.values()).map(c => c.got)) : 0;
    // NO padding on .app-shell any more.
    //
    // Reserving space by padding the shell reflowed the whole app every time a
    // panel opened, and that reflow is what kept breaking things the panel had
    // nothing to do with — the library's action bar, view headers, anything with a
    // width of its own. The user's call, after seeing it happen three times: a side
    // panel should "juste être présent par-dessus sans rien affecter".
    //
    // So a dock is now purely an overlay. It changes nothing about the layout under
    // it; it simply sits on top. The class and the variable below still say a dock
    // is open and how wide it is, so a surface that WANTS to adapt can opt in — but
    // nothing is forced to move any more.
    // ONE state the whole app can lay out against. Rules used to key on
    // `body.tut-docked` only, so the theme editor and the sandbox — same shape,
    // same stolen width — left the mod library's action bar overflowing. A dock is
    // a dock: it moves the app's right edge, whoever opened it.
    document.body.classList.toggle('bmm-docked', width > 0);
    if (width) document.body.style.setProperty('--bmm-dock-w', `${width}px`);
    else document.body.style.removeProperty('--bmm-dock-w');
}

/**
 * Reserve space on the right edge under `id` (idempotent — call it again on resize).
 * Returns the width actually GRANTED, which may be smaller than asked and may be 0.
 * A caller that gets 0 must not dock: there is no room, and taking it anyway is
 * exactly the overlap this module exists to prevent.
 */
export function claimDockSpace(id: string, width: number): number {
    const granted = fitDockWidth(width);
    if (!granted) { _claims.delete(id); _apply(); return 0; }
    _claims.set(id, { want: width, got: granted });
    _apply();
    return granted;
}

/** Give back `id`'s reservation. Any other dock's claim survives. */
export function releaseDockSpace(id: string): void {
    _claims.delete(id);
    _apply();
}

/** Is anything docked right now? */
export function hasDockClaims(): boolean { return _claims.size > 0; }

// Re-fit on resize: a window dragged narrow must shrink its dock rather than let
// it eat the app, and dragging it wide again must give the space back. Debounced —
// resize fires continuously while dragging.
let _rzTimer: ReturnType<typeof setTimeout> | null = null;
window.addEventListener('resize', () => {
    if (!_claims.size) return;
    if (_rzTimer) clearTimeout(_rzTimer);
    _rzTimer = setTimeout(() => {
        const dropped: string[] = [];
        for (const [id, c] of Array.from(_claims.entries())) {
            // Re-fit the ORIGINAL request, so widening the window restores the
            // panel's real preference instead of freezing it at a past clamp.
            const granted = fitDockWidth(c.want);
            if (granted) _claims.set(id, { want: c.want, got: granted });
            else { _claims.delete(id); dropped.push(id); }
        }
        _apply();
        // Every dock that lost its space must be told INDIVIDUALLY. Firing only
        // when the map empties would leave a loser painting over the app whenever
        // another panel still fit — the exact overlap this module prevents.
        if (dropped.length) {
            document.dispatchEvent(new CustomEvent('bmm:dock:no-room', { detail: { ids: dropped } }));
        }
    }, 120);
});

// ── The dock mechanism itself ────────────────────────────────────────────────
//
// Three panels grew the same ~70 lines independently: read a remembered width
// from localStorage, clamp it, write a CSS var, plant a drag grip that updates
// both, persist on mouseup. The copies admitted it in their own comments ("same
// shape as the theme editor's dock"), and they had already drifted — three
// minimums (320/340/380), three storage keys, three near-identical grip handlers.
//
// One factory now owns it. A caller says who it is and what it prefers; it gets
// back the width to use and a grip it can plant. Any future fix — touch support,
// a keyboard resize, a different clamp — lands once.

export interface DockController {
    /** The width to open at: the remembered preference, clamped to what fits.
     *  0 means "no room — do not dock" (see claimDockSpace). */
    width(): number;
    /** Add the drag grip to a panel. Idempotent. */
    plantGrip(panel: HTMLElement, isDocked: () => boolean): void;
}

export function makeDock(opts: {
    id: string;             // the claim id, also used for the grip class
    storageKey: string;     // where the width preference lives
    cssVar: string;         // the var the panel's CSS reads
    min: number;            // this panel's own minimum
    def: number;            // width when nothing is remembered
    gripClass?: string;     // override the grip's class (a panel with its own skin)
    /** Which edge the panel is docked against. Right by default; the tutorial is
     *  the one panel that can also dock LEFT, where the width grows with the
     *  cursor's x instead of against it. */
    side?: () => 'left' | 'right';
}): DockController {
    const read = (): number => {
        const w = parseInt(localStorage.getItem(opts.storageKey) || '', 10);
        return Number.isFinite(w) && w > 0 ? w : opts.def;
    };

    return {
        width(): number {
            // fitDockWidth is the arbiter; opts.min is this panel's own floor on top
            // of it, so a panel that needs more than the global minimum still says so.
            const want = Math.max(opts.min, read());
            return fitDockWidth(want);
        },

        plantGrip(panel: HTMLElement, isDocked: () => boolean): void {
            const cls = opts.gripClass || 'bmm-dock-resize';
            if (panel.querySelector('.' + cls)) return;
            const grip = document.createElement('div');
            grip.className = cls;
            grip.addEventListener('mousedown', (e: MouseEvent) => {
                if (!isDocked()) return;
                e.preventDefault();
                grip.classList.add('dragging');

                // Coalesce to one write per FRAME. A mouse reports at 125–1000Hz and
                // the screen paints at 60 — writing the width on every mousemove
                // invalidated style and forced a relayout several times per frame, and
                // every one of those but the last was thrown away unpainted. That
                // wasted work is exactly what the drag felt like: it juddered because
                // it was doing 4× the layout it could ever show.
                //
                // rAF also puts the write where the browser wants it, so the panel's
                // new width and the frame that shows it are the same frame.
                let pendingX: number | null = null;
                let frame = 0;
                let lastGranted = 0;

                const flush = () => {
                    frame = 0;
                    if (pendingX === null) return;
                    const x = pendingX;
                    pendingX = null;
                    const asked = Math.max(
                        opts.min,
                        (opts.side?.() ?? 'right') === 'left' ? x : window.innerWidth - x,
                    );
                    const granted = claimDockSpace(opts.id, asked);
                    if (granted) {
                        lastGranted = granted;
                        document.body.style.setProperty(opts.cssVar, `${granted}px`);
                    }
                };

                const move = (me: MouseEvent) => {
                    pendingX = me.clientX;
                    if (!frame) frame = requestAnimationFrame(flush);
                };
                const up = () => {
                    grip.classList.remove('dragging');
                    document.removeEventListener('mousemove', move);
                    document.removeEventListener('mouseup', up);
                    if (frame) { cancelAnimationFrame(frame); flush(); }
                    // Persist what was GRANTED, tracked through the drag — reading it
                    // back out of getComputedStyle forced one last synchronous style
                    // resolve just to learn a number we already had.
                    if (lastGranted) {
                        try { localStorage.setItem(opts.storageKey, String(lastGranted)); } catch { /* pref only */ }
                    }
                };
                document.addEventListener('mousemove', move);
                document.addEventListener('mouseup', up);
            });
            panel.appendChild(grip);
        },
    };
}
