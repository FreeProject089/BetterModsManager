// @ts-nocheck
// ── Fixed-position tooltips for [data-tooltip] ─────────────────────────────────
// The old pure-CSS ::after tooltips were clipped by overflow:hidden ancestors and
// could render off-screen near window edges (and below high-z modals). This
// renders ONE shared tooltip at <body> level with position:fixed, clamped to the
// viewport, flipping below the target when there is no room above.

let _tip: HTMLElement | null = null;
let _currentTarget: HTMLElement | null = null;

function ensureTip(): HTMLElement {
    if (_tip && document.body.contains(_tip)) return _tip;
    _tip = document.createElement('div');
    _tip.id = 'bmm-fixed-tooltip';
    document.body.appendChild(_tip);
    return _tip;
}

function show(target: HTMLElement): void {
    const text = target.getAttribute('data-tooltip');
    if (!text) return;
    // Plugins page uses Tasky tooltips instead (matches the old CSS opt-out).
    if (target.closest('#view-plugins')) return;
    _currentTarget = target;
    const tip = ensureTip();
    tip.textContent = text;
    tip.classList.add('visible');

    const r = target.getBoundingClientRect();
    // Measure after content set
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2;
    x = Math.max(6, Math.min(x, window.innerWidth - tw - 6));   // clamp horizontally
    let y = r.top - th - 7;                                      // prefer above
    if (y < 6) y = r.bottom + 7;                                 // flip below if no room
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
}

function hide(): void {
    _currentTarget = null;
    _tip?.classList.remove('visible');
}

export function initTooltips(): void {
    document.addEventListener('mouseover', e => {
        const t = (e.target as HTMLElement)?.closest?.('[data-tooltip]') as HTMLElement | null;
        if (t && t !== _currentTarget) show(t);
        else if (!t && _currentTarget) hide();
    }, true);
    document.addEventListener('mouseout', e => {
        const t = (e.target as HTMLElement)?.closest?.('[data-tooltip]');
        if (t && t === _currentTarget && !(e.relatedTarget as HTMLElement)?.closest?.('[data-tooltip]')) hide();
    }, true);
    // Safety: hide on scroll/click so it never lingers in a stale position.
    window.addEventListener('scroll', hide, true);
    document.addEventListener('mousedown', hide, true);
}
