// @ts-nocheck
// ── [data-tooltip] → the Tasky bubble ──────────────────────────────────────────
//
// There used to be two tooltip systems on screen at once: this module rendered its
// own fixed box for [data-tooltip], while showTaskyHelp() rendered the mascot
// bubble. Elements carrying both — the Mapper's "Show tips" button, for one — showed
// two tooltips saying the same thing, stacked.
//
// The conflict was already known and patched in one place: main.css suppressed the
// CSS tooltip inside #view-plugins "because Tasky replaces it", and show() below
// carried the matching hardcoded opt-out. That is a per-view fix for an app-wide
// problem, and every new view had to remember it.
//
// So [data-tooltip] now feeds the Tasky bubble instead of a second box. Nothing in
// the markup changes — the ~60 existing data-tooltip attributes keep working, they
// just render as the one tooltip the app actually has.

import { showTaskyHelp, hideTaskyHelp } from '../docs/interactive-docs.js';

let _currentTarget: HTMLElement | null = null;

function show(target: HTMLElement): void {
    const text = target.getAttribute('data-tooltip');
    if (!text || !text.trim()) return;
    _currentTarget = target;
    // isLiteral: the attribute holds finished text, not an i18n key. i18n.ts already
    // resolves data-i18n-tooltip into data-tooltip, so translation happens upstream.
    showTaskyHelp(text, 'info', true);
}

function hide(): void {
    if (!_currentTarget) return;
    _currentTarget = null;
    hideTaskyHelp();
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
    // Safety: hide on scroll/click so it never lingers over stale content.
    window.addEventListener('scroll', hide, true);
    document.addEventListener('mousedown', hide, true);
}
