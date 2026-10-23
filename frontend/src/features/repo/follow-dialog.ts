// « Follow a repo »: the dialog behind the Followed repos card's « + Follow a repo », and
// behind every « Follow » button where a repo is already known (the repo just fetched, a
// browse result, a history entry).
//
// What it asks, in the order a person thinks of it:
//
//   address   anything that names the server: `192.168.1.20:8000`, `[::1]:8000`,
//             `http://nas.local/mods/repo.json`, `https://repo.example.com`. The backend
//             (commands/repo_addr.rs) turns it into the repo.json URL and the line under the
//             field says which URL that is, and what plain http means for that host;
//   access    an optional download password (saved SEALED on this PC, so the scheduled check
//             of a protected repo stops failing on a 401) and an optional key from the keyring;
//   test      reads repo.json once and shows its name, version, format and signature;
//   schedule  how often, and what to do with an update (tell / download / download + apply).
//
// Nothing is saved before « Follow ». The test changes nothing either.
import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { uiIcon } from '../../ui/icons.js';
import { openModal } from '../../ui/modal-shell.js';
import { ensureRepoDialogCss } from './repo-dialogs-css.js';

const toast = (msg: string, type = 'info', duration?: number): void => {
    const fn = (window as any).toast;
    if (typeof fn === 'function') fn(msg, type, duration);
};

/** Mirrors `repo_addr::RepoAddr`. */
export interface RepoAddr {
    manifestUrl: string;
    baseUrl: string;
    scheme: string;
    host: string;
    port: number | null;
    kind: 'loopback' | 'lan' | 'public';
    note: 'lanHttp' | 'publicHttp' | null;
}

/** Mirrors `repo_follow::FollowProbe`. */
interface FollowProbe {
    addr: RepoAddr;
    name: string;
    version: string;
    author: string | null;
    game: string;
    format: string | null;
    discovered: boolean;
    signature: 'unsigned' | 'valid' | 'invalid';
    profiles: number;
    mods: number;
    alreadyFollowed: boolean;
    hasPassword: boolean;
}

export interface FollowDialogOpts {
    url?: string;
    name?: string;
    /** Called after a successful « Follow ». */
    onSaved?: () => void;
}

const INTERVALS: Array<[number, string]> = [[15, 'repo.follow.every15m'], [60, 'repo.follow.every1h'], [360, 'repo.follow.every6h'], [1440, 'repo.follow.every1d'], [10080, 'repo.follow.every1w']];
const MODES: Array<[string, string, string]> = [
    ['notify', 'repo.follow.actNotify', 'repo.followDlg.modeNotifyHint'],
    ['download', 'repo.follow.actDownload', 'repo.followDlg.modeDownloadHint'],
    ['apply', 'repo.follow.actApply', 'repo.followDlg.modeApplyHint'],
];

/** A backend answer as a sentence: keys are translated, `HTTP 404` and friends are explained. */
export function followErrText(e: unknown): string {
    const s = String((e as { message?: unknown })?.message ?? e ?? '').trim();
    if (/^[a-z][\w]*(\.[\w]+)+$/.test(s)) return t(s);
    const http = /^HTTP (\d{3})$/.exec(s);
    if (http) return t('repo.followDlg.errHttp', { code: http[1] });
    if (/timed? ?out/i.test(s)) return t('repo.followDlg.errTimeout');
    if (/connect|dns|resolve|refused|unreachable|error sending request/i.test(s)) return t('repo.followDlg.errUnreachable');
    return s;
}

function noteHtml(a: RepoAddr): string {
    if (!a.note) return `<span class="rdlg-note rdlg-note--ok">${uiIcon('lock', 12)}<span>${escHtml(t('repo.addr.https'))}</span></span>`;
    if (a.note === 'lanHttp') return `<span class="rdlg-note">${uiIcon('info', 12)}<span>${escHtml(t('repo.addr.lanHttp'))}</span></span>`;
    return `<span class="rdlg-note rdlg-note--warn">${uiIcon('warning', 12)}<span>${escHtml(t('repo.addr.publicHttp'))}</span></span>`;
}

function probeHtml(p: FollowProbe): string {
    const sig = p.signature === 'valid'
        ? `<span class="bms-chip bms-chip--ok">${uiIcon('shield-check', 12)}${escHtml(t('repo.followDlg.sigValid'))}</span>`
        : p.signature === 'invalid'
            ? `<span class="bms-chip bms-chip--danger">${uiIcon('error', 12)}${escHtml(t('repo.followDlg.sigInvalid'))}</span>`
            : `<span class="bms-chip">${uiIcon('shield', 12)}${escHtml(t('repo.followDlg.sigNone'))}</span>`;
    const fmt = p.discovered
        ? t('repo.followDlg.fmtDiscovered')
        : p.format ? t('repo.followDlg.fmtVersion', { v: p.format }) : t('repo.followDlg.fmtOld');
    const rows: Array<[string, string]> = [
        [t('repo.followDlg.rVersion'), p.version ? `v${p.version}` : '—'],
        [t('repo.followDlg.rFormat'), fmt],
        [t('repo.followDlg.rContent'), t('repo.followDlg.content', { mods: String(p.mods), profiles: String(p.profiles) })],
    ];
    if (p.game) rows.push([t('repo.followDlg.rGame'), p.game]);
    if (p.author) rows.push([t('repo.followDlg.rAuthor'), p.author]);
    return `<div class="rdlg-result rdlg-result--ok" role="status">
        <div class="rdlg-result-h">${uiIcon('success', 16)}<strong>${escHtml(p.name || p.addr.host)}</strong>${sig}</div>
        <dl class="rdlg-dl">${rows.map(([k, v]) => `<dt>${escHtml(k)}</dt><dd>${escHtml(v)}</dd>`).join('')}</dl>
        ${p.alreadyFollowed ? `<p class="rdlg-hint">${uiIcon('info', 12)}${escHtml(t('repo.followDlg.already'))}</p>` : ''}
        ${p.signature === 'invalid' ? `<p class="rdlg-hint rdlg-hint--bad">${escHtml(t('repo.followDlg.sigInvalidHint'))}</p>` : ''}
    </div>`;
}

/** Open the dialog. Resolves when it closes. */
export async function openFollowDialog(opts: FollowDialogOpts = {}): Promise<void> {
    ensureRepoDialogCss();
    // The keyring, for the optional « sign with this key » choice. A ring that cannot be read
    // just means no choice is offered.
    let keys: Array<{ name: string }> = [];
    try { keys = ((await invoke('key_auth_list')) as { keys?: Array<{ name: string }> } | null)?.keys || []; } catch { keys = []; }

    const body = `
      <form class="rdlg" autocomplete="off" novalidate>
        <label class="rdlg-field">
          <span class="rdlg-label">${escHtml(t('repo.followDlg.address'))}</span>
          <input class="form-input rdlg-mono" name="url" spellcheck="false" autocapitalize="off"
                 value="${escAttr(opts.url || '')}" placeholder="${escAttr(t('repo.followDlg.addressPh'))}"
                 aria-describedby="rdlg-addr-out">
          <span class="rdlg-out" id="rdlg-addr-out" aria-live="polite"></span>
        </label>

        <div class="rdlg-row">
          <label class="rdlg-field">
            <span class="rdlg-label">${escHtml(t('repo.followDlg.password'))} <span class="rdlg-opt">${escHtml(t('repo.followDlg.optional'))}</span></span>
            <input class="form-input" name="password" type="password" autocomplete="new-password" placeholder="${escAttr(t('repo.followDlg.passwordPh'))}">
          </label>
          <label class="rdlg-field">
            <span class="rdlg-label">${escHtml(t('repo.followDlg.key'))} <span class="rdlg-opt">${escHtml(t('repo.followDlg.optional'))}</span></span>
            <select class="form-input" name="key">
              <option value="">${escHtml(t('repo.followDlg.keyAuto'))}</option>
              ${keys.map((k) => `<option value="${escAttr(k.name)}">${escHtml(k.name)}</option>`).join('')}
            </select>
          </label>
        </div>
        <p class="rdlg-hint" data-r="pw-hint">${uiIcon('lock', 12)}<span>${escHtml(t('repo.followDlg.passwordHint'))}</span></p>
        <label class="rdlg-check" data-r="forget" hidden><input type="checkbox" name="forget"> <span>${escHtml(t('repo.followDlg.forgetPw'))}</span></label>

        <div class="rdlg-test">
          <button type="button" class="btn btn-secondary btn-sm" data-r="test">${uiIcon('activity', 14)}<span>${escHtml(t('repo.followDlg.test'))}</span></button>
          <div data-r="result" class="rdlg-result-slot" aria-live="polite"></div>
        </div>

        <div class="rdlg-row">
          <label class="rdlg-field">
            <span class="rdlg-label">${escHtml(t('repo.follow.interval'))}</span>
            <select class="form-input" name="interval">
              ${INTERVALS.map(([m, k]) => `<option value="${m}"${m === 360 ? ' selected' : ''}>${escHtml(t(k))}</option>`).join('')}
            </select>
          </label>
          <label class="rdlg-field">
            <span class="rdlg-label">${escHtml(t('repo.follow.action'))}</span>
            <select class="form-input" name="mode">
              ${MODES.map(([v, k]) => `<option value="${v}">${escHtml(t(k))}</option>`).join('')}
            </select>
          </label>
        </div>
        <p class="rdlg-hint" data-r="mode-hint"></p>
      </form>`;

    const footer = `
      <button type="button" class="btn btn-ghost" data-r="cancel">${escHtml(t('common.cancel'))}</button>
      <button type="button" class="btn btn-primary" data-r="save">${uiIcon('add', 14)}<span>${escHtml(t('repo.followDlg.save'))}</span></button>`;

    await new Promise<void>((resolve) => {
        const m = openModal({
            title: t('repo.followDlg.title'),
            subtitle: t('repo.followDlg.subtitle'),
            icon: uiIcon('bell', 20),
            size: 'md',
            className: 'rdlg-modal',
            body,
            footer,
            initialFocus: 'input[name="url"]',
            onClose: () => resolve(),
        });
        const form = m.q<HTMLFormElement>('form.rdlg')!;
        const field = <T extends HTMLElement>(name: string) => form.querySelector<T>(`[name="${name}"]`)!;
        const part = <T extends HTMLElement>(r: string) => m.dialog.querySelector<T>(`[data-r="${r}"]`)!;
        const urlIn = field<HTMLInputElement>('url');
        const pwIn = field<HTMLInputElement>('password');
        const out = m.q<HTMLElement>('#rdlg-addr-out')!;
        const result = part<HTMLElement>('result');
        const testBtn = part<HTMLButtonElement>('test');
        const saveBtn = part<HTMLButtonElement>('save');
        let addr: RepoAddr | null = null;
        let addrErr = '';
        let probed: FollowProbe | null = null;
        let seq = 0;

        const showMode = (): void => {
            const v = field<HTMLSelectElement>('mode').value;
            const k = MODES.find(([x]) => x === v)?.[2] || MODES[0][2];
            part<HTMLElement>('mode-hint').textContent = t(k);
        };
        showMode();
        field<HTMLSelectElement>('mode').addEventListener('change', showMode);

        /** The URL line under the field, from the backend's own normaliser. */
        const normalise = async (): Promise<RepoAddr | null> => {
            const raw = urlIn.value.trim();
            const mine = ++seq;
            if (!raw) { addr = null; addrErr = ''; out.innerHTML = `<span class="rdlg-muted">${escHtml(t('repo.followDlg.addressHint'))}</span>`; return null; }
            try {
                const a = await invoke('repo_addr_normalize', { input: raw }) as RepoAddr | null;
                if (mine !== seq) return addr;
                addr = a; addrErr = '';
                out.innerHTML = a
                    ? `<span class="rdlg-url">${escHtml(t('repo.followDlg.willRead'))} <code>${escHtml(a.manifestUrl)}</code></span>${noteHtml(a)}`
                    : '';
            } catch (e) {
                if (mine !== seq) return addr;
                addr = null; addrErr = followErrText(e);
                out.innerHTML = `<span class="rdlg-note rdlg-note--bad">${uiIcon('error', 12)}<span>${escHtml(addrErr)}</span></span>`;
            }
            return addr;
        };
        let timer: ReturnType<typeof setTimeout> | null = null;
        urlIn.addEventListener('input', () => {
            probed = null;
            result.innerHTML = '';
            part<HTMLElement>('forget').hidden = true;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => { void normalise(); }, 220);
        });
        void normalise();

        const test = async (): Promise<FollowProbe | null> => {
            const a = await normalise();
            if (!a) { urlIn.focus(); if (!urlIn.value.trim()) out.innerHTML = `<span class="rdlg-note rdlg-note--bad">${uiIcon('error', 12)}<span>${escHtml(t('repo.follow.errNoUrl'))}</span></span>`; return null; }
            testBtn.disabled = true;
            result.innerHTML = `<div class="rdlg-result">${uiIcon('loader', 14, { cls: 'spin' })}<span>${escHtml(t('repo.followDlg.testing', { url: a.manifestUrl }))}</span></div>`;
            try {
                const p = await invoke('repo_follow_probe', { url: a.manifestUrl, password: pwIn.value || null }) as FollowProbe | null;
                if (!p) throw new Error(t('repo.followDlg.errNoAnswer'));
                probed = p;
                result.innerHTML = probeHtml(p);
                part<HTMLElement>('forget').hidden = !p.hasPassword;
                if (p.hasPassword) pwIn.placeholder = t('repo.followDlg.passwordSaved');
                return p;
            } catch (e) {
                probed = null;
                const msg = followErrText(e);
                const needPw = String(e).includes('repo.errPasswordRequired');
                result.innerHTML = `<div class="rdlg-result rdlg-result--bad" role="alert">${uiIcon('error', 16)}<div><strong>${escHtml(t('repo.followDlg.testFailed'))}</strong><p>${escHtml(msg)}</p></div></div>`;
                if (needPw) pwIn.focus();
                return null;
            } finally {
                testBtn.disabled = false;
            }
        };
        testBtn.addEventListener('click', () => { void test(); });
        // Enter in the address runs the test; Enter anywhere else in the form follows.
        form.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || e.isComposing) return;
            const tgt = e.target as HTMLElement;
            if (tgt.tagName === 'BUTTON' || tgt.tagName === 'SELECT') return;
            e.preventDefault();
            if (tgt === urlIn) void test(); else saveBtn.click();
        });
        form.addEventListener('submit', (e) => e.preventDefault());
        part<HTMLButtonElement>('cancel').addEventListener('click', () => m.close());

        saveBtn.addEventListener('click', async () => {
            const a = await normalise();
            if (!a) { urlIn.focus(); if (!addrErr) out.innerHTML = `<span class="rdlg-note rdlg-note--bad">${uiIcon('error', 12)}<span>${escHtml(t('repo.follow.errNoUrl'))}</span></span>`; return; }
            saveBtn.disabled = true;
            try {
                const name = probed?.name || opts.name || null;
                await invoke('repo_follow_set', {
                    url: a.baseUrl, name,
                    patch: { enabled: true, intervalMin: Number(field<HTMLSelectElement>('interval').value) || 360, action: field<HTMLSelectElement>('mode').value },
                });
                const pw = pwIn.value;
                const forget = field<HTMLInputElement>('forget').checked;
                if (pw || forget) {
                    const where = String(await invoke('repo_follow_set_secret', { url: a.baseUrl, password: forget && !pw ? null : pw }) || '');
                    if (where === 'memory') toast(t('repo.followDlg.pwMemoryOnly'), 'warning', 8000);
                }
                const key = field<HTMLSelectElement>('key').value;
                if (key) await invoke('key_auth_set_for_url', { url: a.manifestUrl, name: key }).catch((e) => toast(followErrText(e), 'warning'));
                toast(t('repo.follow.added', { name: name || a.host }), 'success');
                m.close();
                opts.onSaved?.();
            } catch (e) {
                toast(followErrText(e), 'error');
            } finally {
                saveBtn.disabled = false;
            }
        });
    });
}
