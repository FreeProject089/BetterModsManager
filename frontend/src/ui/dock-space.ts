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
    const shell = document.querySelector('.app-shell') as HTMLElement | null;
    if (shell) shell.style.paddingRight = width ? `${width}px` : '';
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
