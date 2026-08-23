import { t } from './i18n.js';

// "This source is protected": the password and the key, on every screen that adds a catalogue.
//
// One block, four mount points — the app, plugin, theme and preset catalogue screens. Written
// once because it is one rule: what a protected source asks for does not change with the kind
// of thing it holds, and four copies would be four chances for one to keep asking for a
// password after the others learned about keys.
//
// The two halves are deliberately different in scope, and the block says so rather than
// pretending they match:
//
//   · the PASSWORD is per source, and kept for this run only — never written to disk. That is
//     the rule already in force everywhere here; what was missing was a way to give it BEFORE
//     a fetch fails rather than fetching, failing, and only then being asked.
//   · the KEY is per SERVER, because a proof is addressed to one origin. One request carries
//     one proof, so every catalogue on a host shares the answer whether a screen admits it or
//     not. Admitting it is the honest option.

/** Markup for the block. `p` prefixes every id so several can coexist on one page. */
export function sourceAccessHtml(p: string): string {
    return `
    <details class="src-access" id="${p}-access">
      <summary>${t('srcacc.title')}</summary>
      <div class="src-access-body">
        <label class="src-access-label" for="${p}-access-url">${t('srcacc.url')}</label>
        <input type="text" class="input input-sm" id="${p}-access-url" spellcheck="false"
               placeholder="${t('srcacc.urlPh')}">

        <label class="src-access-label" for="${p}-access-key">${t('srcacc.key')}</label>
        <div class="src-access-row">
          <select class="input input-sm" id="${p}-access-key"></select>
          <button type="button" class="btn btn-sm" id="${p}-access-manage">${t('srcacc.manage')}</button>
        </div>
        <div class="src-access-hint">${t('srcacc.keyHint')}</div>

        <label class="src-access-label" for="${p}-access-pw">${t('srcacc.pw')}</label>
        <div class="src-access-row">
          <input type="password" class="input input-sm" id="${p}-access-pw" autocomplete="new-password">
          <button type="button" class="btn btn-sm" id="${p}-access-pw-set">${t('srcacc.pwSet')}</button>
        </div>
        <div class="src-access-hint">${t('srcacc.pwHint')}</div>
      </div>
    </details>`;
}

/**
 * Wire a mounted block.
 *
 * `seedUrl` pre-fills the address field from whatever the screen's own "add a source" input
 * currently holds, so the common case — paste an address, discover it is protected — does not
 * make you type it a second time.
 */
export function wireSourceAccess(
    p: string,
    notify: (msg: string, kind: 'success' | 'warning') => void,
    // Supplied by the caller rather than imported: this module lives in core/, and reaching
    // into ui/ for navigation is a core -> ui -> core cycle the dep-graph gate counts. The
    // screen knows how to get somewhere; this only knows that it should.
    manageKeys: () => void,
    seedUrl?: () => string,
): void {
    const urlEl = document.getElementById(`${p}-access-url`) as HTMLInputElement | null;
    const det = document.getElementById(`${p}-access`) as HTMLDetailsElement | null;
    if (!urlEl || !det) return;
    const urlOf = () => urlEl.value.trim();

    const paint = async () => {
        const kr = await import('./identity-key.js');
        await kr.renderKeySelect(`${p}-access-key`, urlOf,
            (k, kind) => notify(t(k), kind), t);
    };

    det.addEventListener('toggle', () => {
        if (!det.open) return;
        // Seed on OPEN, not on render: the address field above is usually filled in after the
        // screen is built, and reading it at build time would seed an empty string forever.
        if (!urlEl.value && seedUrl) urlEl.value = seedUrl();
        void paint();
    });
    // The chooser answers a question about ONE server, so a changed address needs a repaint —
    // leaving the old answer under a new address would be a confident wrong reading.
    urlEl.addEventListener('change', () => { void paint(); });

    // The ring is edited in ONE place. Sending you there beats a second editor that could
    // disagree with the first about which keys exist.
    document.getElementById(`${p}-access-manage`)?.addEventListener('click', manageKeys);

    document.getElementById(`${p}-access-pw-set`)?.addEventListener('click', async () => {
        const pwEl = document.getElementById(`${p}-access-pw`) as HTMLInputElement | null;
        const url = urlOf();
        const pw = pwEl?.value || '';
        if (!/^https?:\/\//i.test(url)) { notify(t('settings.catIndex.pwBadUrl'), 'warning'); return; }
        if (!pw) { notify(t('settings.catIndex.pwEmpty'), 'warning'); return; }
        const { rememberSourcePassword } = await import('./source-fetch.js');
        rememberSourcePassword(url, pw);
        // Cleared at once: a password left sitting in a visible field is how it ends up in a
        // screenshot, and the fetcher already has it by this point.
        if (pwEl) pwEl.value = '';
        notify(t('settings.catIndex.pwOk'), 'success');
    });
}
