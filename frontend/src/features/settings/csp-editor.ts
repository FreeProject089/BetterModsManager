// Settings → Security → Content-Security-Policy.
//
// The policy BMM ships with lives in index.html. This screen shows it directive by
// directive, marks the sources that weaken it, and lets somebody add a second policy of
// their own.
//
// The one asymmetry worth understanding before reading the code: a browser enforces every
// policy it was given, so two policies produce their INTERSECTION. Anything added here can
// only ever make the app stricter - there is no way to loosen the shipped policy from this
// screen. That is deliberate. A settings page that could relax a CSP is the first page an
// attacker with script execution would open.
//
// It applies on the next launch, not immediately, and the screen says so. A CSP meta tag is
// only honoured while the document is being parsed; frontend/csp-boot.js writes it at that
// moment from localStorage, which is the only store readable synchronously that early.
import { escHtml } from '../../core/utils.js';
import { t } from '../../core/i18n.js';

const KEY = 'bmm.csp.extra';

/** Sources that make a directive permissive, and what each one actually costs. */
const WEAKENING: Record<string, string> = {
    "'unsafe-inline'": 'csp.risk.unsafeInline',
    "'unsafe-eval'": 'csp.risk.unsafeEval',
    'https://*': 'csp.risk.anyHttps',
    'http://*': 'csp.risk.anyHttp',
    '*': 'csp.risk.anything',
    'data:': 'csp.risk.dataUrl',
};

/** What a source costs IN THIS DIRECTIVE.
 *
 *  `'unsafe-inline'` does not mean the same thing twice. In script-src it is what lets an
 *  injected `<img src=x onerror=…>` run; in style-src it permits inline style attributes,
 *  which this app uses on almost every element. The panel printed the script sentence under
 *  style-src — alarming, and wrong about what the line in front of you does.
 */
function costOf(directive: string, source: string): string {
    if (source === "'unsafe-inline'" && !EXECUTES.has(directive)) {
        return directive.startsWith('style')
            ? t('csp.risk.unsafeInlineStyle')
            : t('csp.risk.unsafeInlineOther');
    }
    return t(WEAKENING[source]);
}

/** Directives where a permissive source is a real problem rather than a cosmetic one. */
const EXECUTES = new Set(['script-src', 'script-src-elem', 'default-src', 'object-src', 'worker-src']);

export interface Directive {
    name: string;
    sources: string[];
    /** Weakening sources present, paired with what they cost. */
    risks: { source: string; why: string }[];
    /** True when a weakening source sits in a directive that governs code execution. */
    severe: boolean;
}

/** Parse a policy string into directives. Tolerant: extra whitespace, trailing `;`. */
export function parsePolicy(policy: string): Directive[] {
    return String(policy || '')
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => {
            const parts = d.split(/\s+/);
            const name = (parts.shift() || '').toLowerCase();
            const risks = parts
                .filter((p) => WEAKENING[p] !== undefined)
                .map((source) => ({ source, why: costOf(name, source) }));
            return { name, sources: parts, risks, severe: risks.length > 0 && EXECUTES.has(name) };
        });
}

/** The policy the running document was loaded with — read from the meta tag, not hardcoded,
 *  so this screen cannot drift away from what index.html actually ships. */
export function shippedPolicy(): string {
    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy" i]');
    return meta?.getAttribute('content') || '';
}

export function savedExtra(): string {
    try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}

/** Same validation csp-boot.js applies, so this screen refuses what the loader would drop
 *  silently on the next launch — a setting that saves and then does nothing is worse than
 *  one that refuses. */
export function validate(policy: string): string | null {
    const p = policy.trim();
    if (!p) return null;                                  // empty = "no extra policy"
    if (/[<>"\r\n]/.test(p)) return t('csp.errNoAngle');
    if (p.length > 4096) return t('csp.errTooLong');
    const bad = parsePolicy(p).find((d) => !/^[a-z-]+$/.test(d.name));
    if (bad) return t('csp.errNotDirective').replace('{name}', bad.name);
    if (!parsePolicy(p).length) return t('csp.errNoDirective');
    return null;
}

/** Presets. Each is ADDED to the shipped policy, so each can only tighten.
 *
 *  `label` and `note` are TRANSLATION KEYS, not text: resolved where they are displayed, so
 *  the panel follows a language change instead of freezing whatever language it was built in.
 */
export const PRESETS: { id: string; label: string; note: string; policy: string }[] = [
    {
        id: 'none',
        label: 'csp.preset.none',
        note: 'csp.preset.none.note',
        policy: '',
    },
    {
        id: 'network',
        label: 'csp.preset.network',
        note: 'csp.preset.network.note',
        policy: "connect-src 'self' http://127.0.0.1:* http://localhost:* ipc: tauri: https://bettercommunity.ch https://api.github.com https://raw.githubusercontent.com; object-src 'none'; base-uri 'self'",
    },
    {
        id: 'strict',
        label: 'csp.preset.strict',
        note: 'csp.preset.strict.note',
        policy: "script-src 'self'; object-src 'none'; base-uri 'self'",
    },
];

/** Render one directive row. */
function directiveRow(d: Directive): string {
    const tone = d.severe ? 'var(--bmm-danger)' : d.risks.length ? 'var(--bmm-warning, #f59e0b)' : 'var(--text-muted)';
    const mark = d.severe ? '!' : d.risks.length ? '~' : '';
    return `
        <div class="csp-row${d.severe ? ' is-severe' : ''}">
            <span class="csp-row-mark" style="color:${tone}">${mark}</span>
            <div class="csp-row-body">
                <code class="csp-row-name">${escHtml(d.name)}</code>
                <div class="csp-row-sources">${d.sources.map((sv) => escHtml(sv)).join(' ') || `<em>${escHtml(t('csp.empty'))}</em>`}</div>
                ${d.risks.map((r) => `<div class="csp-row-risk" style="color:${tone}">${escHtml(r.source)} — ${escHtml(r.why)}</div>`).join('')}
            </div>
        </div>`;
}

/** The whole panel, as HTML. Wire it with `bindCspEditor` after inserting. */
export function renderCspEditor(): string {
    const shipped = parsePolicy(shippedPolicy());
    const severe = shipped.filter((d) => d.severe).length;
    const extra = savedExtra();

    // The shipped policy opens COLLAPSED. It is reference material — thirty-odd directives
    // nobody reads line by line — and expanding it by default was most of what made this
    // screen feel like a debug dump. The summary keeps the two numbers that matter.
    const summary = escHtml(t('csp.shippedPolicy').replace('{n}', String(shipped.length)))
        + (severe ? ` <span class="csp-severe-count">${escHtml(t('csp.executeWarning').replace('{n}', String(severe)))}</span>` : '');

    return `
    <div class="setting-card csp-card">
        <div class="csp-head">
            <span class="csp-title">${escHtml(t('csp.title'))}</span>
            <span class="csp-badge">${escHtml(t('csp.notRecommended'))}</span>
        </div>
        <p class="csp-intro">${escHtml(t('csp.intro'))}</p>

        <details class="csp-details">
            <summary class="csp-summary">${summary}</summary>
            <div id="csp-directives" class="csp-directives">${shipped.map(directiveRow).join('')}</div>
        </details>

        <div class="csp-section-label">${escHtml(t('csp.addPolicy'))}</div>
        <div id="csp-presets" class="csp-presets">
            ${PRESETS.map((p) => `<button type="button" class="btn btn-xs" data-csp-preset="${escHtml(p.id)}" title="${escHtml(t(p.note))}">${escHtml(t(p.label))}</button>`).join('')}
        </div>
        <textarea id="csp-extra" class="csp-extra" rows="4" spellcheck="false"
            placeholder="${escHtml(t('csp.placeholder'))}">${escHtml(extra)}</textarea>
        <div id="csp-msg" class="csp-msg"></div>
        <div class="csp-actions">
            <button type="button" id="csp-save" class="btn btn-xs btn-primary">${escHtml(t('csp.save'))}</button>
            <button type="button" id="csp-clear" class="btn btn-xs">${escHtml(t('csp.clear'))}</button>
        </div>
        <p class="csp-foot">${escHtml(t('csp.appliesNextLaunch'))}</p>
    </div>`;
}

/** Attach behaviour. Call once, after the panel is in the DOM. */
/** Store an extra policy, or clear it. The one place that writes the key.
 *
 *  Returns the validation error, or null on success. Everything that can install a policy
 *  goes through here: the Settings panel and the installer handoff. Two writers of the same
 *  key would be two chances to skip the validation csp-boot.js also performs at startup —
 *  and the one that skipped it would simply be ignored on the next launch, silently.
 */
export function setExtraPolicy(policy: string): string | null {
    const value = String(policy || '').trim();
    if (!value) {
        try { localStorage.removeItem(KEY); } catch { /* nothing to remove */ }
        return null;
    }
    const err = validate(value);
    if (err) return err;
    try { localStorage.setItem(KEY, value); } catch { return t('csp.storageUnavailable'); }
    return null;
}

/** Apply a named preset from PRESETS. Unknown id → false, and nothing is written.
 *
 *  Used by the installer handoff, where the choice arrives as a preset ID rather than a
 *  policy string: an installer dropdown must not be able to inject an arbitrary CSP, and a
 *  preset id is a choice among known values.
 */
export function applyPresetById(id: string): boolean {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return false;
    return setExtraPolicy(p.policy) === null;
}

/** Repaint on a language change.
 *
 *  `applyTranslations()` repaints elements carrying `data-i18n`; this panel is generated
 *  HTML, so none of it is reached that way. Without this the card TITLE switched language
 *  and the preset buttons inside it did not — verified, and it looks like a half-broken
 *  translation rather than a panel that was simply never told.
 *
 *  Guarded so the listener is attached once no matter how often the panel is rebuilt.
 */
let langHooked = false;
function hookLangChange(): void {
    if (langHooked) return;
    langHooked = true;
    document.addEventListener('langChanged', () => {
        const host = document.getElementById('csp-editor-host');
        if (!host || !document.getElementById('csp-extra')) return;
        const keep = (document.getElementById('csp-extra') as HTMLTextAreaElement | null)?.value ?? '';
        host.innerHTML = renderCspEditor();
        const ta = document.getElementById('csp-extra') as HTMLTextAreaElement | null;
        // Keep what was typed but not yet saved: a language change is not a reason to
        // discard someone's draft policy.
        if (ta && keep) ta.value = keep;
        bindCspEditor(host);
    });
}

export function bindCspEditor(root: ParentNode = document): void {
    hookLangChange();
    const ta = root.querySelector<HTMLTextAreaElement>('#csp-extra');
    const msg = root.querySelector<HTMLElement>('#csp-msg');
    if (!ta || !msg) return;

    const say = (text: string, ok: boolean) => {
        msg.textContent = text;
        msg.style.color = ok ? 'var(--bmm-success, #22c55e)' : 'var(--bmm-danger)';
    };

    root.querySelectorAll<HTMLButtonElement>('[data-csp-preset]').forEach((b) => {
        b.addEventListener('click', () => {
            const p = PRESETS.find((x) => x.id === b.dataset.cspPreset);
            if (!p) return;
            ta.value = p.policy;
            say(t(p.note), true);
        });
    });

    root.querySelector('#csp-save')?.addEventListener('click', () => {
        const err = setExtraPolicy(ta.value);
        if (err) return say(err, false);
        say(t('csp.saved'), true);
    });

    root.querySelector('#csp-clear')?.addEventListener('click', () => {
        setExtraPolicy('');
        ta.value = '';
        say(t('csp.removed'), true);
    });
}
