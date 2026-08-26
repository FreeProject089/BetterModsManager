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
          <!-- A chooser with nothing in it is disabled, which is correct and a dead end: the
               only way to get a key was ssh-keygen in a terminal, which is a different skill
               from using a mod manager. Both doors are here now. -->
          <button type="button" class="btn btn-sm" id="${p}-access-new">${t('srcacc.newKey')}</button>
          <button type="button" class="btn btn-sm" id="${p}-access-add">${t('srcacc.addKey')}</button>
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
/**
 * Close whatever modal `el` is sitting in, on the way somewhere else.
 *
 * Exported because it is needed by more than one block, and a rule written twice diverges —
 * which is exactly what happened: the protected-source fold closed its modal before
 * navigating to Settings, the SSH fold did not, and the second one left a dialog covering
 * the page it had just sent the reader to. Whoever adds the third fold gets this for free.
 *
 * Matched on "the class contains overlay" rather than on a list of known class names. The old
 * list (`.modal-overlay, .mpc-overlay, .sched-pc-overlay, .tc-src-overlay`) had to be edited
 * every time a screen invented its own marker class, and forgetting to is silent: the button
 * still navigates, so it looks like it worked.
 *
 * Prefers the modal's own close button, because that is what runs whatever cleanup the screen
 * attached to closing — removing the node behind its back skips it.
 */
export function closeOwningOverlay(el: Element): void {
    // EVERY open overlay, not just the one this element sits in.
    //
    // A modal opened from another modal is not nested in the DOM: both are appended to
    // #app-window-outer, so the second is a SIBLING of the first. Walking up the ancestor
    // chain therefore reaches the inner one and stops — which is exactly what people saw,
    // one of the two modals closing and the other left sitting over the page they had just
    // been sent to. No amount of care with the ancestor walk can fix that; the relationship
    // it is looking for does not exist.
    //
    // The element is still used, but only for ORDER: its own overlay closes first, so a
    // parent that repaints on close does not repaint a child that is about to vanish.
    const mine: Element[] = [];
    for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
        if (/overlay/.test(typeof n.className === 'string' ? n.className : '')) mine.push(n);
    }
    // VISIBILITY is what tells an open overlay from a closed one here, and only visibility.
    //
    // Measured in the running app, because the obvious guesses are all wrong: every modal in
    // BMM computes `display: flex` whether it is open or shut, `.open` is on some markers and
    // not others, and `opacity` is 0 mid-fade on a modal that is genuinely open. A predicate
    // built on any of those matches every closed modal in the app — and since this function
    // CLICKS THEIR CLOSE BUTTONS, that is not a cosmetic mistake.
    const open = Array.from(document.querySelectorAll('[class*="overlay"]'))
        .filter((n) => !n.hasAttribute('hidden'))
        .filter((n) => {
            const cs = getComputedStyle(n);
            return cs.visibility !== 'hidden' && cs.display !== 'none';
        });

    const seen = new Set<Element>();
    for (const node of [...mine, ...open]) {
        if (seen.has(node) || !node.isConnected) continue;
        seen.add(node);
        // The modal's own close button when it has one: that is what runs whatever cleanup
        // the screen attached to closing. Removing the node behind its back skips it.
        const close = node.querySelector('.modal-close, [data-close]') as HTMLElement | null;
        if (close) close.click(); else node.remove();
    }
}

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
    if (!urlEl || !det) {
        // LOUD. A silent return here is how the scheduler's catalogue shipped with a dead
        // block: its overlay was painted before being attached, so these ids were not in the
        // document, wiring gave up without a word, and the screen looked finished. The
        // caller made a real mistake — the markup is not on the page when it said it was —
        // and the only cheap way to notice is to say so.
        console.error(
            `[source-access] "${p}" was wired before its markup was in the document `
            + '(paint into a detached node? mounted after wiring?). The key chooser and the '
            + 'manage button on that screen will do nothing.',
        );
        return;
    }
    const urlOf = () => urlEl.value.trim();

    const paint = async () => {
        try {
            const kr = await import('./identity-key.js');
            await kr.renderKeySelect(`${p}-access-key`, urlOf,
                (k, kind) => notify(t(k), kind), t);
        } catch {
            // The import itself can fail on a partial build. Reported rather than dropped:
            // `void paint()` used to let this vanish as an unhandled rejection, leaving a fold
            // that opens onto nothing and explains nothing.
            notify(t('settings.identity.authKeyUnavailable'), 'warning');
        }
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
    //
    // Whatever modal this block sits in is closed FIRST. Navigating out from under an open
    // overlay left the Settings page behind a dimmer you could not dismiss, because the modal
    // that owned it belonged to the screen you just left.
    document.getElementById(`${p}-access-manage`)?.addEventListener('click', () => {
        closeOwningOverlay(det);
        manageKeys();
    });

    // Add a key you already have, and make one you do not. Both land on the same ring the
    // Settings screen edits — one value with several doors, never several values.
    /**
     * A name nothing on the ring is using yet.
     *
     * Generating refuses a name already taken — rightly, since two keys under one name is a
     * ring where the one that signs is whichever was written last. Asking the person for a
     * name before they have a key is asking about something that does not exist, so the first
     * one is just "BMM" and the rest count up. Renaming lives in Settings.
     */
    const freshKeyName = async (): Promise<string> => {
        const kr = await import('./identity-key.js');
        const view = await kr.listKeyring().catch(() => null);
        // keys is an ARRAY of { name, path }. Object.keys on it returns "0", "1", … — so the
        // set never held a real name, every call answered "BMM", and the second one collided
        // with the first as errNameTaken.
        const taken = new Set((view?.keys || []).map((k) => k.name));
        if (!taken.has('BMM')) return 'BMM';
        for (let n = 2; n < 999; n += 1) if (!taken.has(`BMM ${n}`)) return `BMM ${n}`;
        return `BMM ${Date.now()}`;
    };

    document.getElementById(`${p}-access-add`)?.addEventListener('click', async () => {
        const { pickFile } = await import('./api.js');
        const path = await pickFile([{ name: 'Private key', extensions: ['key', 'pem', ''] }]).catch(() => null);
        if (!path) return;
        // Named after the file, because asking for a name before the file is picked is asking
        // about something nobody has looked at yet. It is renameable in Settings.
        const name = String(path).replace(/^.*[/\\]/, '').replace(/\.[^.]+$/, '') || 'key';
        try {
            const { invoke } = await import('./api.js');
            await invoke('key_auth_add', { name, path });
            notify('srcacc.keyAdded', 'success');
            const kr = await import('./identity-key.js');
            await kr.refreshKeySelect(`${p}-access-key`, urlOf, t);
        } catch (e) {
            // The message IS the reason: a file that is not a key, or one that is passphrase
            // protected, fail differently and only the backend knows which.
            notify(String(e).split('|')[0] || 'srcacc.keyAddFailed', 'warning');
        }
    });

    document.getElementById(`${p}-access-new`)?.addEventListener('click', async () => {
        try {
            const { invoke } = await import('./api.js');
            const res: any = await invoke('key_auth_generate', { name: await freshKeyName() });
            // The PUBLIC line goes to the clipboard, because it is the one thing that has to
            // leave this machine and a toast is too small to read a key out of.
            try { await navigator.clipboard.writeText(String(res?.public || '')); } catch { /* no clipboard */ }
            notify('srcacc.keyMade', 'success');
            const kr = await import('./identity-key.js');
            await kr.refreshKeySelect(`${p}-access-key`, urlOf, t);
        } catch (e) {
            notify(String(e).split('|')[0] || 'srcacc.keyMadeFailed', 'warning');
        }
    });

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
