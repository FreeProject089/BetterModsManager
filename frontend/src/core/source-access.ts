import { t } from './i18n.js';
import { openKeyManager } from './settings-link.js';

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
      <summary data-i18n="srcacc.title">${t('srcacc.title')}</summary>
      <div class="src-access-body">
        <label class="src-access-label" for="${p}-access-url" data-i18n="srcacc.url">${t('srcacc.url')}</label>
        <input type="text" class="input input-sm" id="${p}-access-url" spellcheck="false"
               data-i18n-placeholder="srcacc.urlPh" placeholder="${t('srcacc.urlPh')}">

        <label class="src-access-label" for="${p}-access-key" data-i18n="srcacc.key">${t('srcacc.key')}</label>
        <!-- The ring's state in words, painted by wireSourceAccess: « no key yet » and « this
             build cannot read the ring » used to look the same, a greyed-out empty chooser. -->
        <p class="src-access-state" id="${p}-access-state" data-state="loading" hidden></p>
        <div class="src-access-row">
          <select class="input input-sm" id="${p}-access-key"></select>
          <!-- A chooser with nothing in it is disabled, which is correct and a dead end: the
               only way to get a key was ssh-keygen in a terminal, which is a different skill
               from using a mod manager. Both doors are here now. -->
          <button type="button" class="btn btn-sm btn-secondary" id="${p}-access-new" data-i18n="srcacc.newKey">${t('srcacc.newKey')}</button>
          <button type="button" class="btn btn-sm btn-secondary" id="${p}-access-add" data-i18n="srcacc.addKey">${t('srcacc.addKey')}</button>
          <button type="button" class="btn btn-sm btn-ghost" id="${p}-access-manage" data-i18n="srcacc.manage">${t('srcacc.manage')}</button>
        </div>
        <div class="src-access-hint" data-i18n="srcacc.keyHint">${t('srcacc.keyHint')}</div>

        <label class="src-access-label" for="${p}-access-pw" data-i18n="srcacc.pw">${t('srcacc.pw')}</label>
        <div class="src-access-row">
          <input type="password" class="input input-sm" id="${p}-access-pw" autocomplete="new-password">
          <button type="button" class="btn btn-sm btn-secondary" id="${p}-access-pw-set" data-i18n="srcacc.pwSet">${t('srcacc.pwSet')}</button>
        </div>
        <div class="src-access-hint" data-i18n="srcacc.pwHint">${t('srcacc.pwHint')}</div>
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
    // Where « Manage keys » goes. Omitted (undefined) = Settings → Identity & API, on the
    // keyring row (core/settings-link.ts). Screens pass something else only to do more first.
    manageKeys: (() => void) | undefined,
    seedUrl?: () => string,
): void {
    // Messages reach the screen TRANSLATED. Half of this file passed i18n keys and half passed
    // sentences, and most screens toast what they get: « srcacc.keyMade » was shown as is.
    // A key-shaped message is translated here; a sentence goes through untouched.
    const notifyRaw = notify;
    notify = (msg, kind) => notifyRaw(/^[a-z][\w-]*(\.[\w-]+)+$/i.test(msg) ? t(msg) : msg, kind);
    const goManage = manageKeys || openKeyManager;
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

    // The ring in words, and the doors that fit it: with no key, « Create one » is THE action
    // (primary) and the empty chooser steps aside; when the ring cannot be read, making or
    // adding a key would fail the same way, so those two are disabled and the line says why.
    const paintState = async (kr: typeof import('./identity-key.js')) => {
        const state = document.getElementById(`${p}-access-state`);
        const sel = document.getElementById(`${p}-access-key`) as HTMLSelectElement | null;
        const mk = document.getElementById(`${p}-access-new`) as HTMLButtonElement | null;
        const add = document.getElementById(`${p}-access-add`) as HTMLButtonElement | null;
        let st: 'none' | 'keys' | 'broken' = 'broken';
        try { st = (await kr.listKeyring()).keys.length ? 'keys' : 'none'; } catch { st = 'broken'; }
        if (state) {
            state.dataset.state = st;
            state.hidden = st === 'keys';
            state.textContent = st === 'none' ? t('srcacc.noKey') : st === 'broken' ? t('settings.identity.authKeyUnavailable') : '';
        }
        if (sel) sel.hidden = st !== 'keys';
        mk?.classList.toggle('btn-primary', st === 'none');
        mk?.classList.toggle('btn-secondary', st !== 'none');
        if (mk) mk.disabled = st === 'broken';
        if (add) add.disabled = st === 'broken';
    };
    const paint = async () => {
        try {
            const kr = await import('./identity-key.js');
            await kr.renderKeySelect(`${p}-access-key`, urlOf,
                (k, kind) => notify(t(k), kind), t);
            await paintState(kr);
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
    // The state line and the chooser's sentence are painted, not data-i18n: repainted on a
    // language switch while the block is open.
    document.addEventListener('langChanged', () => { if (det.isConnected && det.open) void paint(); });

    // The ring is edited in ONE place. Sending you there beats a second editor that could
    // disagree with the first about which keys exist.
    //
    // Whatever modal this block sits in is closed FIRST. Navigating out from under an open
    // overlay left the Settings page behind a dimmer you could not dismiss, because the modal
    // that owned it belonged to the screen you just left.
    document.getElementById(`${p}-access-manage`)?.addEventListener('click', () => {
        closeOwningOverlay(det);
        goManage();
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
        const { invoke } = await import('./api.js');
        const added = async (passphrase?: string) => {
            await invoke('key_auth_add', { name, path, passphrase });
            notify('srcacc.keyAdded', 'success');
            await paint();
        };
        try {
            await added();
        } catch (e) {
            // The message IS the reason: a file that is not a key, and one that is protected
            // by a passphrase, fail differently and only the backend knows which.
            //
            // A protected key used to end here as "could not add that key", which reads as
            // "this file is no good" — so the answer was to go and make an unprotected one.
            // It is a locked door, not a broken one: ask for the key to it.
            if (!String(e).startsWith('repo.ssh.errKeyDecode')) {
                notify(String(e).split('|')[0] || 'srcacc.keyAddFailed', 'warning');
                return;
            }
            const { promptRepoPassword } = await import('../ui/ask-one.js');
            // Re-asked until it opens or the person gives up, with the reason shown each
            // time: a silent second prompt looks exactly like the first and reads as a
            // broken dialog rather than as a mistyped character.
            let error = '';
            for (;;) {
                const pass = await promptRepoPassword({
                    title: t('srcacc.keyLockedTitle'),
                    desc: t('srcacc.keyLockedDesc'),
                    placeholder: t('srcacc.keyPassphrase'),
                    error,
                });
                if (pass === null) return;
                try { await added(pass); return; }
                catch (e2) { error = t('srcacc.keyPassphraseWrong'); console.warn('[key]', e2); }
            }
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
            await paint();
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
