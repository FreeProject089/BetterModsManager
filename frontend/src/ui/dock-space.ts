// dock-space.ts — ONE owner for the space docked side panels reserve.
//
// Three panels can dock to the right edge (the tutorial, the theme editor, the
// translation sandbox) and each used to write `.app-shell` style.paddingRight
// directly. Docking a second one overwrote the first's reservation, and undocking
// either one cleared the padding the still-docked panel depended on — leaving it
// painting over live app content.
//
// Here the padding is a function of ALL open docks: each names itself, the widest
// wins (they stack at the same edge), and releasing one recomputes from whoever is
// left instead of guessing.

const _claims = new Map<string, number>();

function _apply(): void {
    const width = _claims.size ? Math.max(...Array.from(_claims.values())) : 0;
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

/** Reserve `width` px on the right edge under `id` (idempotent — call on resize). */
export function claimDockSpace(id: string, width: number): void {
    _claims.set(id, width);
    _apply();
}

/** Give back `id`'s reservation. Any other dock's claim survives. */
export function releaseDockSpace(id: string): void {
    _claims.delete(id);
    _apply();
}
