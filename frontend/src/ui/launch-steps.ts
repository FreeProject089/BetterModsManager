// launch-steps.ts — the start-up dialogs BMM already had, as steps of the launch deck.
//
// Each block below is an ADAPTER. The decision it makes (`when`) and what it saves are the ones
// the old dialog made and saved — same keys, same values, same commands — and where the old
// code can be reached without importing the app frame it is called rather than copied. What
// changes is only WHERE the question is asked: in one deck, with Previous / Next, instead of a
// relay of overlays.
//
// Functions that live in update-notes.ts (the terms' "accepted" record, the Markdown renderer
// the legal texts and release notes have always used, the full release-notes window, the PTB
// guide) are handed in by app.ts as hooks. update-notes.ts imports the app frame, so importing
// it from here would close an import cycle; the hooks keep this module a leaf.
//
// Order, required steps first so Close works as soon as the questions are answered:
//   10 language · 20 terms · 30 privacy policy · 40 file access · 50 telemetry
//   60 crash · 70 release notes · 75 test build · 80+ announcements · 90 BetterCommunity · 100 Ko-fi

import { invoke } from '../core/api.js';
import { t, getLang, getLanguages, setLang } from '../core/i18n.js';
import { getLinks } from '../core/links-config.js';
import {
    registerLaunchStep, openLaunchDeck, deckEnabled, setDeckEnabled, isLaunchDeckOpen,
    type LaunchStep, type LaunchContext, type LaunchStepApi,
} from './launch-deck.js';
import { safeHttpsUrl } from './launch-logic.js';
import { announcementSteps, prefetchLaunchFeed, appVersion, announcementsEnabled, setAnnouncementsEnabled } from './launch-announcements.js';
import { detectPreviousCrash, markCrashSeen, type CrashFinding } from './crash-detect.js';
import { bcIntroWanted, setBcIntroOptOut } from './bettercommunity-modal.js';
import { kofiWanted, kofiOptedOut, setKofiOptOut, snoozeKofi, kofiLink } from './kofi-modal.js';

/** What app.ts hands in from update-notes.ts (see the header for why they are not imported). */
export interface LaunchHooks {
    /** The renderer the terms, the policy and the release notes have always been drawn with. */
    renderMarkdown(md: string): string;
    /** Records the terms as accepted — the exact function the old Accept button called. */
    markEulaAccepted(): void;
    /** The full release-notes window (every note, with its folder tree). */
    openFullReleaseNotes(): void;
    /** The test-build (PTB) guide. */
    openPtbGuide(): void;
    /**
     * The telemetry consent dialog (core/analytics.ts `showConsentModal`), resolving on the
     * answer. Handed in rather than imported: analytics reaches the app frame through the theme
     * engine, and importing it here closed an import cycle through the command palette.
     */
    showConsentModal(): Promise<unknown>;
}

// ── the keys the old dialogs wrote (unchanged) ─────────────────────────────────────
const LANG_SELECTED_KEY = 'bmm_lang_selected';
const EULA_ACCEPTED_KEY = 'bmm_eula_accepted';
const EULA_HASH_KEY = 'bmm_eula_accepted_hash';
const PRIVACY_SEEN_KEY = 'bmm_privacy_seen';
const PRIVACY_HASH_KEY = 'bmm_privacy_seen_hash';
const RELEASE_NOTES_SHOWN_KEY = 'bmm_release_notes_shown';
const PTB_DISMISSED_KEY = 'bmm_ptb_dismissed';           // sessionStorage, as before
// New with the deck: which version's notes were shown, and the notes' own "don't show again".
const RELEASE_NOTES_VERSION_KEY = 'bmm_release_notes_seen_version';
const RELEASE_NOTES_MUTE_KEY = 'bmm_launch_mute_release_notes';

const ls = {
    get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
    set(k: string, v: string): void { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
    del(k: string): void { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
}

function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
}

// ── legal: the same "accepted THIS text" rule update-notes.ts applies ──────────────
//
// A copy of `legalHashes` + `acceptedCurrent` (update-notes.ts), which are not exported and
// live in a file this module cannot import (see the header). Kept byte-for-byte in behaviour,
// including the one-time adoption of a pre-fingerprint `true`. Owner: export them from
// update-notes.ts and this copy can go.
let _legal: Promise<{ tos: string | null; privacy: string | null }> | null = null;
function legalHashes(): Promise<{ tos: string | null; privacy: string | null }> {
    if (!_legal) {
        _legal = (async () => {
            try {
                const r: any = await invoke('legal_fingerprint', {}, { quiet: true });
                return { tos: r?.tos ?? null, privacy: r?.privacy ?? null };
            } catch { return { tos: null, privacy: null }; }
        })();
    }
    return _legal;
}
function acceptedCurrent(key: string, hashKey: string, current: string | null): boolean {
    const legacy = ls.get(key) === 'true';
    const stored = ls.get(hashKey);
    if (!current) return legacy || !!stored;
    if (stored) return stored === current;
    if (legacy) { ls.set(hashKey, current); return true; }
    return false;
}

/** Whether the terms are due at this launch: shown ⇔ auto-TOS on and THIS text not accepted. */
let _tosDue: Promise<boolean> | null = null;
function tosDue(): Promise<boolean> {
    if (!_tosDue) {
        _tosDue = (async () => {
            try {
                const enabled = await invoke('is_auto_eula_enabled', {}, { quiet: true });
                if (!enabled) return false;
                const { tos } = await legalHashes();
                return !acceptedCurrent(EULA_ACCEPTED_KEY, EULA_HASH_KEY, tos);
            } catch (e) {
                console.warn('[BMM] Auto EULA check failed:', e);
                return false;
            }
        })();
    }
    return _tosDue;
}

/**
 * Links inside rendered text open in the system browser, https only. Followed in place they
 * would navigate the app's own window away from BMM.
 */
function wireLinks(box: HTMLElement): void {
    box.addEventListener('click', (e) => {
        const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
        if (!a) return;
        e.preventDefault();
        const url = safeHttpsUrl(a.getAttribute('href') || '');
        if (url) void invoke('open_external', { url }).catch(() => { /* the browser refused */ });
    });
}

function mdBox(): HTMLElement {
    const box = el('div', 'ld-md');
    box.tabIndex = 0;   // a scroll box the keyboard can scroll
    box.textContent = t('common.loading');
    wireLinks(box);
    return box;
}

function legalPane(host: HTMLElement, load: () => Promise<string>, hooks: LaunchHooks): void {
    const box = mdBox();
    host.appendChild(box);
    load().then((md) => { box.innerHTML = hooks.renderMarkdown(md); })
        .catch((err) => { box.textContent = `${t('common.error')}: ${err}`; });
}

// ── the core steps ────────────────────────────────────────────────────────────────

function coreSteps(hooks: LaunchHooks): LaunchStep[] {
    let crash: CrashFinding | null = null;

    const language: LaunchStep = {
        id: 'language',
        priority: 10,
        required: true,
        when: (ctx) => !ctx.manual && ls.get(LANG_SELECTED_KEY) !== 'true',
        title: () => t('launch.lang.title'),
        render: (host) => {
            // Built once. A language switch re-words it in place rather than rebuilding it, so
            // the radio that was just picked keeps the keyboard focus.
            const lede = el('p', 'ld-lede', t('launch.lang.lede'));
            const list = el('div', 'ld-choices');
            list.setAttribute('role', 'radiogroup');
            list.setAttribute('aria-label', t('launch.lang.title'));
            const current = getLang();
            for (const l of getLanguages()) {
                const row = el('label', 'ld-choice' + (l.code === current ? ' is-on' : ''));
                const r = el('input');
                r.type = 'radio';
                r.name = 'ld-lang';
                r.value = l.code;
                r.checked = l.code === current;
                r.addEventListener('change', () => {
                    if (!r.checked) return;
                    list.querySelectorAll('.ld-choice').forEach((n) => n.classList.toggle('is-on', n === row));
                    void setLang(l.code);
                });
                const code = el('span', 'ld-choice-tag', /^[a-z]{2}$/i.test(l.flag || '') ? String(l.flag).toUpperCase() : l.code.toUpperCase());
                row.append(r, code, el('span', 'ld-choice-name', l.name));
                list.appendChild(row);
            }
            host.append(lede, list);
            const reword = (): void => {
                lede.textContent = t('launch.lang.lede');
                list.setAttribute('aria-label', t('launch.lang.title'));
            };
            document.addEventListener('langChanged', reword);
            language.onClosed = () => document.removeEventListener('langChanged', reword);
        },
        // Next IS the choice, exactly like the old picker's OK button.
        commit: () => { ls.set(LANG_SELECTED_KEY, 'true'); },
        primaryLabel: () => t('launch.lang.confirm'),
    };

    const terms: LaunchStep = {
        id: 'terms',
        priority: 20,
        required: true,
        when: (ctx) => (ctx.manual ? false : tosDue()),
        title: () => t('credits.eula'),
        kicker: () => t('tos.subtitle'),
        render: (host, api) => {
            legalPane(host, async () => String(await invoke('get_eula_text', { lang: getLang() })), hooks);
            const row = el('div', 'ld-actions');
            row.append(
                // Quit is what it always was: leaving, not declining-and-continuing.
                button(t('eula.quit'), 'btn btn-danger', () => { void invoke('exit_app'); }),
                button(t('eula.accept'), 'btn btn-primary', () => {
                    hooks.markEulaAccepted();
                    api.complete();
                    api.next();
                }),
            );
            host.appendChild(row);
        },
    };

    const privacy: LaunchStep = {
        id: 'privacy',
        priority: 30,
        // Shown on the launch the terms are, as before (it followed the terms, only when they
        // were shown), and then whenever the policy text changes — the fingerprint's job.
        required: true,
        when: async (ctx) => {
            if (ctx.manual || !(await tosDue())) return false;
            const { privacy: hash } = await legalHashes();
            return !acceptedCurrent(PRIVACY_SEEN_KEY, PRIVACY_HASH_KEY, hash);
        },
        title: () => t('credits.privacy'),
        kicker: () => t('privacy.subtitle'),
        render: (host) => {
            legalPane(host, async () => String(await invoke('get_privacy_text', { lang: getLang() })), hooks);
        },
        // The old dialog's explicit "I have read the policy" — same two keys it wrote.
        commit: async () => {
            ls.set(PRIVACY_SEEN_KEY, 'true');
            const { privacy: hash } = await legalHashes();
            if (hash) ls.set(PRIVACY_HASH_KEY, hash);
        },
        primaryLabel: () => t('privacy.accept'),
    };

    const fileAccess: LaunchStep = {
        id: 'file-access',
        priority: 40,
        required: true,
        // Not on the very first launch (it was deferred there to de-spam it), then until chosen.
        when: async (ctx) => {
            if (ctx.manual || ctx.firstRun) return false;
            try { const s: any = await invoke('get_settings'); return !s.fs_security_mode; }
            catch (e) { console.error('[Security] Failed to check security mode:', e); return false; }
        },
        title: () => t('security.modal.title'),
        render: (host, api) => renderFileAccess(host, api),
    };

    const telemetry: LaunchStep = {
        id: 'telemetry',
        priority: 50,
        required: true,
        when: async (ctx) => {
            if (ctx.manual || ctx.firstRun) return false;
            try { return (await invoke('get_analytics_consent', {}, { quiet: true })) === null; }
            catch { return false; }
        },
        title: () => t('analytics.consentTitle'),
        render: (host, api) => hostConsent(host, api, telemetry, hooks),
    };

    const crashStep: LaunchStep = {
        id: 'crash',
        priority: 60,
        when: async (ctx) => {
            if (ctx.manual) return false;
            crash = await detectPreviousCrash();
            return crash !== null;
        },
        title: () => t('crash.title'),
        kicker: () => t('crash.subtitle'),
        render: (host, api) => renderCrash(host, api, () => crash),
        onShown: () => { if (crash) void markCrashSeen(crash); },
    };

    const releaseNotes: LaunchStep = {
        id: 'release-notes',
        priority: 70,
        when: async (ctx) => {
            if (ctx.manual) return true;
            if (ls.get(RELEASE_NOTES_MUTE_KEY) === '1') return false;
            const v = await appVersion();
            // Once per VERSION now. The old flag was a bare `true` that nothing ever reset, so
            // "what's new" was shown once per install and never again after an update.
            return v ? ls.get(RELEASE_NOTES_VERSION_KEY) !== v : ls.get(RELEASE_NOTES_SHOWN_KEY) !== 'true';
        },
        title: () => t('launch.notes.title'),
        kicker: () => t('launch.notes.kicker'),
        render: (host, api) => renderReleaseNotes(host, api, hooks),
        onShown: () => {
            ls.set(RELEASE_NOTES_SHOWN_KEY, 'true');
            void appVersion().then((v) => { if (v) ls.set(RELEASE_NOTES_VERSION_KEY, v); });
        },
        mute: {
            get: () => ls.get(RELEASE_NOTES_MUTE_KEY) === '1',
            set: (on) => (on ? ls.set(RELEASE_NOTES_MUTE_KEY, '1') : ls.del(RELEASE_NOTES_MUTE_KEY)),
            label: () => t('launch.notes.mute'),
        },
    };

    const testBuild: LaunchStep = {
        id: 'ptb',
        priority: 75,
        when: async (ctx) => {
            if (ctx.manual) return false;
            try { if (sessionStorage.getItem(PTB_DISMISSED_KEY)) return false; } catch { /* no session storage */ }
            try { return !!(await invoke('is_ptb_mode', {}, { quiet: true })); } catch { return false; }
        },
        title: () => t('launch.ptb.title'),
        render: (host, api) => {
            host.appendChild(el('p', 'ld-lede', t('launch.ptb.lede')));
            const row = el('div', 'ld-actions');
            row.appendChild(button(t('launch.ptb.open'), 'btn btn-secondary', () => api.closeThen(hooks.openPtbGuide)));
            host.appendChild(row);
        },
        // Once per session, as the guide's own close did.
        onShown: () => { try { sessionStorage.setItem(PTB_DISMISSED_KEY, 'true'); } catch { /* ignore */ } },
    };

    const bettercommunity: LaunchStep = {
        id: 'bettercommunity',
        priority: 90,
        when: (ctx) => !ctx.manual && !ctx.firstRun && bcIntroWanted(),
        title: () => t('launch.bc.title'),
        kicker: () => t('bc.sub'),
        render: (host) => renderBetterCommunity(host),
        mute: { get: () => !bcIntroWanted(), set: setBcIntroOptOut, label: () => t('bc.hide') },
    };

    const kofi: LaunchStep = {
        id: 'kofi',
        priority: 100,
        when: (ctx) => !ctx.manual && !ctx.firstRun && kofiWanted(),
        title: () => t('kofi.title'),
        render: (host, api) => renderKofi(host, api),
        mute: { get: kofiOptedOut, set: setKofiOptOut, label: () => t('kofi.dontShow') },
    };

    return [language, terms, privacy, fileAccess, telemetry, crashStep, releaseNotes, testBuild, bettercommunity, kofi];
}

// ── step bodies ───────────────────────────────────────────────────────────────────

/** File-access mode: the same two cards and the same four calls as security-modal.ts. */
function renderFileAccess(host: HTMLElement, api: LaunchStepApi): void {
    host.appendChild(el('p', 'ld-lede', t('security.modal.desc')));
    let selected: 'full' | 'limited' = 'full';
    const list = el('div', 'ld-choices');
    list.setAttribute('role', 'radiogroup');
    list.setAttribute('aria-label', t('security.modal.title'));
    const card = (mode: 'full' | 'limited', title: string, desc: string, badge?: string): HTMLElement => {
        const row = el('label', 'ld-choice ld-choice--card' + (mode === selected ? ' is-on' : ''));
        const r = el('input');
        r.type = 'radio';
        r.name = 'ld-fs-mode';
        r.value = mode;
        r.checked = mode === selected;
        r.addEventListener('change', () => {
            if (!r.checked) return;
            selected = mode;
            list.querySelectorAll('.ld-choice').forEach((n) => n.classList.toggle('is-on', n === row));
        });
        const txt = el('span', 'ld-choice-txt');
        const head = el('span', 'ld-choice-name', title);
        if (badge) head.appendChild(el('span', 'ld-badge', badge));
        txt.append(head, el('span', 'ld-choice-desc', desc));
        row.append(r, txt);
        return row;
    };
    list.append(
        // The title already says "(Recommended)" in both languages; the old card added a badge
        // saying it a second time.
        card('full', t('security.modal.full'), t('security.modal.fullDesc')),
        card('limited', t('security.modal.limited'), t('security.modal.limitedDesc')),
    );
    host.appendChild(list);
    const err = el('p', 'ld-error');
    err.hidden = true;
    const row = el('div', 'ld-actions');
    const apply = button(t('security.modal.apply'), 'btn btn-primary', async () => {
        apply.disabled = true;
        err.hidden = true;
        try {
            const settings: any = await invoke('get_settings');
            settings.fs_security_mode = selected;
            await invoke('update_settings', { settings });
            await invoke('apply_fs_security_mode_command');
            api.complete();
            api.next();
        } catch (e) {
            console.error('[Security] Error saving mode:', e);
            err.textContent = `${t('common.error')}: ${e}`;
            err.hidden = false;
            apply.disabled = false;
        }
    });
    row.appendChild(apply);
    host.append(err, row);
}

/**
 * Telemetry: the consent dialog's own card, moved into the deck.
 *
 * Its logic is the most delicate of all the start-up questions — the installer pre-selection,
 * three toggles, what "decline" records — so it is not rewritten here. showConsentModal() builds
 * it exactly as before; this takes the card out of its overlay and puts it in the step. Every
 * listener travels with the elements, and the promise it returns still resolves on the answer.
 */
function hostConsent(host: HTMLElement, api: LaunchStepApi, step: LaunchStep, hooks: LaunchHooks): void {
    let answered: Promise<unknown>;
    try { answered = hooks.showConsentModal(); }
    catch (e) {
        console.warn('[BMM] consent step failed', e);
        host.appendChild(el('p', 'ld-error', t('launch.stepError')));
        api.complete();   // never hold the deck on a question that could not be put
        return;
    }
    // showConsentModal builds its overlay synchronously, before its first await.
    const overlay = document.getElementById('analytics-consent-overlay');
    const card = overlay?.querySelector('.modal') as HTMLElement | null;
    if (overlay && card) {
        card.classList.add('ld-hosted');
        host.appendChild(card);
        // The emptied backdrop stays out of sight until the deck closes and removes it.
        // `hidden` would lose to `.modal-overlay.open { display: flex }`.
        overlay.style.display = 'none';
    }
    // If the card could not be moved, the dialog stays where it was built — above the deck —
    // and is answered there; the step completes either way.
    step.onClosed = () => { overlay?.remove(); };
    void answered.then(() => {
        // Answered: the card stays readable if the reader steps back to it, but its buttons are
        // spent (the dialog ignores a second click anyway) and should look it.
        card?.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        api.complete();
        api.next();
    }, () => { api.complete(); });
}

function renderCrash(host: HTMLElement, api: LaunchStepApi, finding: () => CrashFinding | null): void {
    const f = finding();
    host.appendChild(el('p', 'ld-lede', t('crash.desc')));
    if (f?.newest) {
        const box = el('div', 'ld-file');
        box.append(el('span', 'ld-file-label', t('crash.pathLabel')), el('code', 'ld-file-path', f.newest));
        host.appendChild(box);
    }
    host.appendChild(el('p', 'ld-muted', t('crash.helpText')));
    // The buttons drive the crash notice's own controls (wired by initCrashReportUI), after
    // putting the path where those handlers read it — one implementation, not two.
    const primePath = (): void => {
        const p = document.getElementById('crash-zip-path');
        if (p && f?.newest) p.textContent = f.newest;
    };
    const row = el('div', 'ld-actions');
    if (f?.newest) {
        row.appendChild(button(t('crash.openZip'), 'btn btn-secondary', () => {
            primePath();
            document.getElementById('btn-crash-open-zip')?.click();
        }));
    }
    row.appendChild(button(t('crash.reportBc'), 'btn btn-primary', () => {
        primePath();
        api.closeThen(() => document.getElementById('btn-crash-report-betahub')?.click());
    }));
    host.appendChild(row);
}

async function renderReleaseNotes(host: HTMLElement, api: LaunchStepApi, hooks: LaunchHooks): Promise<void> {
    const box = mdBox();
    host.appendChild(box);
    const row = el('div', 'ld-actions');
    row.appendChild(button(t('launch.notes.all'), 'btn btn-secondary', () => api.closeThen(hooks.openFullReleaseNotes)));
    host.appendChild(row);
    try {
        const lang = getLang();
        const notes = (await invoke('get_update_notes', { subDir: null, lang })) as Array<{ filename: string; content: string }> || [];
        // The root note in the reader's language, as the full window picks it.
        const suffix = lang === 'fr' ? '_FR.md' : '_EN.md';
        const note = notes.find((n) => n.filename.endsWith(suffix)) || notes[0];
        if (!note) { box.textContent = t('launch.notes.none'); return; }
        box.innerHTML = hooks.renderMarkdown(note.content);
    } catch (e) {
        box.textContent = `${t('common.error')}: ${e}`;
    }
}

function renderBetterCommunity(host: HTMLElement): void {
    const L = getLinks();
    host.appendChild(el('p', 'bc-lede', t('bc.lede')));
    const column = (title: string, lines: string[]): HTMLElement => {
        const sec = el('section', 'bc-col');
        sec.appendChild(el('h3', 'bc-h', title));
        const ul = el('ul', 'bc-list');
        for (const l of lines) ul.appendChild(el('li', 'bc-li', l));
        sec.appendChild(ul);
        return sec;
    };
    const split = el('div', 'bc-split');
    // Each key written out: check-i18n-keys reads literal t() calls.
    split.append(
        column(t('bc.site'), [t('bc.site.1'), t('bc.site.2'), t('bc.site.3'), t('bc.site.4'), t('bc.site.5')]),
        column(t('bc.bot'), [t('bc.bot.1'), t('bc.bot.2'), t('bc.bot.3'), t('bc.bot.4'), t('bc.bot.5'), t('bc.bot.6')]),
    );
    host.appendChild(split);
    const ok = el('p', 'bc-ok');
    ok.append(el('b', undefined, t('bc.opt.t')), document.createTextNode(` ${t('bc.opt.b')}`));
    host.appendChild(ok);
    const row = el('div', 'ld-actions');
    const open = (url: string) => () => { void invoke('open_external', { url }).catch(() => { /* the browser refused */ }); };
    if (L.discord_bot_invite) row.appendChild(button(t('bc.addbot'), 'btn btn-sm btn-secondary', open(L.discord_bot_invite)));
    if (L.discord) row.appendChild(button(t('bc.join'), 'btn btn-sm btn-secondary', open(L.discord)));
    if (L.bettercommunity) row.appendChild(button(t('bc.open'), 'btn btn-sm btn-primary', open(L.bettercommunity)));
    host.appendChild(row);
}

function renderKofi(host: HTMLElement, api: LaunchStepApi): void {
    const top = el('div', 'ld-kofi');
    const img = el('img', 'ld-kofi-img');
    img.src = 'assets/Tasky_Happy.png';
    img.alt = '';
    const say = el('div', 'ld-kofi-say');
    say.append(el('p', 'ld-lede', t('kofi.text2')), el('span', 'ld-badge', t('kofi.freeBadge')));
    top.append(img, say);
    host.appendChild(top);
    host.appendChild(el('p', 'ld-muted', t('kofi.anchor')));
    const row = el('div', 'ld-actions');
    row.append(
        button(t('kofi.later'), 'btn btn-secondary', () => { snoozeKofi(); api.next(); }),
        button(t('kofi.support'), 'btn btn-primary', () => { void invoke('open_external', { url: kofiLink() }).catch(() => { /* the browser refused */ }); }),
    );
    (row.firstElementChild as HTMLElement).title = t('kofi.snoozeHint');
    host.appendChild(row);
}

// ── Settings: two switches, next to the other start-up / notification preferences ──

const SETTINGS_ROW_ID = 'set-row-launch-deck';

/** Draw the two switches into Settings (after "BetterCommunity notifications"). Idempotent. */
export function mountLaunchSettings(): void {
    if (document.getElementById(SETTINGS_ROW_ID)) return;
    const anchor = document.getElementById('toggle-notif-bcweb')?.closest('.set-row');
    if (!anchor || !anchor.parentElement) return;
    const row = (id: string, titleKey: string, descKey: string, checked: boolean, onChange: (on: boolean) => void, extra?: HTMLElement): HTMLElement => {
        const r = el('div', 'set-row');
        r.id = id;
        const txt = el('div');
        const title = el('div', 'set-row-title', t(titleKey));
        title.setAttribute('data-i18n', titleKey);
        const desc = el('div', 'set-row-desc', t(descKey));
        desc.setAttribute('data-i18n', descKey);
        txt.append(title, desc);
        if (extra) txt.appendChild(extra);
        const sw = el('label', 'toggle-switch');
        sw.style.flexShrink = '0';
        const box = el('input');
        box.type = 'checkbox';
        box.checked = checked;
        box.setAttribute('aria-label', t(titleKey));
        box.addEventListener('change', () => onChange(box.checked));
        sw.append(box, el('span', 'toggle-slider'));
        r.append(txt, sw);
        return r;
    };
    const again = button(t('launch.settings.showNow'), 'btn btn-sm btn-secondary ld-set-btn', () => { void openWhatsNew(); });
    again.setAttribute('data-i18n', 'launch.settings.showNow');
    const deckRow = row(SETTINGS_ROW_ID, 'launch.settings.deck', 'launch.settings.deckDesc', deckEnabled(), setDeckEnabled, again);
    const annRow = row('set-row-launch-ann', 'launch.settings.ann', 'launch.settings.annDesc', announcementsEnabled(), setAnnouncementsEnabled);
    anchor.after(deckRow, annRow);
}

// ── entry points ──────────────────────────────────────────────────────────────────

let _hooks: LaunchHooks | null = null;
let _startupRan = false;

/**
 * The start-up pass: register the core steps, collect, open once. Resolves when the deck closes,
 * or at once when nothing needed saying. Called once by app.ts after boot.
 */
export async function runStartupDeck(ctx: { firstRun: boolean }, hooks: LaunchHooks): Promise<void> {
    _hooks = hooks;
    try { mountLaunchSettings(); } catch (e) { console.warn('[BMM] launch settings failed', e); }
    if (_startupRan) return;
    _startupRan = true;
    for (const s of coreSteps(hooks)) registerLaunchStep(s);
    const full: LaunchContext = { firstRun: ctx.firstRun, manual: false };
    if (ctx.firstRun) {
        // A fresh install has no previous version: its "what's new" is the whole app, which
        // the onboarding tour covers. Mark this version's notes as seen, as before.
        ls.set(RELEASE_NOTES_SHOWN_KEY, 'true');
        const v = await appVersion();
        if (v) ls.set(RELEASE_NOTES_VERSION_KEY, v);
    }
    void prefetchLaunchFeed();
    const anns = await announcementSteps(full);
    await openLaunchDeck(full, anns);
}

/** "Show what's new" — the command palette and the Settings button. Release notes + announcements. */
export async function openWhatsNew(): Promise<void> {
    if (isLaunchDeckOpen()) return;
    if (!_hooks) return;   // before boot finished: nothing to draw with yet
    const ctx: LaunchContext = { firstRun: false, manual: true };
    const anns = await announcementSteps(ctx);
    const opened = await openLaunchDeck(ctx, anns);
    // The notes step is always eligible when asked for, so this only happens if the deck could
    // not draw: fall back to the full release-notes window rather than doing nothing.
    if (!opened) _hooks.openFullReleaseNotes();
}
