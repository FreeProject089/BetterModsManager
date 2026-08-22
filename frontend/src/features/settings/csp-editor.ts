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

const KEY = 'bmm.csp.extra';

/** Sources that make a directive permissive, and what each one actually costs. */
const WEAKENING: Record<string, string> = {
    "'unsafe-inline'": 'inline <script> and on… attributes execute — an injected `<img onerror>` runs',
    "'unsafe-eval'": 'building code from strings at runtime is allowed',
    'https://*': 'any host on the internet, so anything read can be sent anywhere',
    'http://*': 'any host, over plaintext',
    '*': 'anything at all',
    'data:': 'data: URLs count as a source',
};

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
                .map((source) => ({ source, why: WEAKENING[source] }));
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
    if (/[<>"\r\n]/.test(p)) return 'A policy cannot contain < > " or a line break.';
    if (p.length > 4096) return 'That is longer than 4096 characters — check what you pasted.';
    const bad = parsePolicy(p).find((d) => !/^[a-z-]+$/.test(d.name));
    if (bad) return `"${bad.name}" is not a directive name.`;
    if (!parsePolicy(p).length) return 'No directive found. A policy looks like: script-src \'self\'';
    return null;
}

/** Presets. Each is ADDED to the shipped policy, so each can only tighten. */
export const PRESETS: { id: string; label: string; note: string; policy: string }[] = [
    {
        id: 'none',
        label: 'Shipped policy only',
        note: 'What BMM installs with. Nothing added.',
        policy: '',
    },
    {
        id: 'network',
        label: 'Pin the network',
        note: 'Keeps script as-is, but stops the app talking to arbitrary hosts. If an injected script ever ran, this is what would stop it sending anything out. Breaks any feature that fetches from a host not listed here.',
        policy: "connect-src 'self' http://127.0.0.1:* http://localhost:* ipc: tauri: https://bettercommunity.ch https://api.github.com https://raw.githubusercontent.com; object-src 'none'; base-uri 'self'",
    },
    {
        id: 'strict',
        label: 'Strict — first-party scripts only',
        note: "The shipped policy already refuses inline script AND code built from strings: an injected <img onerror=…> does not execute, and neither does anything built from a string at runtime. What this adds is dropping the third-party script hosts (YouTube, BetaHub, Google), so ONLY BMM's own files can run. Cost: embedded videos and the BetaHub feedback widget stop working.",
        policy: "script-src 'self'; object-src 'none'; base-uri 'self'",
    },
];

/** Render one directive row. */
function directiveRow(d: Directive): string {
    const tone = d.severe ? 'var(--bmm-danger)' : d.risks.length ? 'var(--bmm-warning, #f59e0b)' : 'var(--text-muted)';
    const mark = d.severe ? '!' : d.risks.length ? '~' : '';
    return `
        <div style="display:grid;grid-template-columns:16px 150px 1fr;gap:8px;padding:6px 0;border-top:1px solid var(--border-subtle,rgba(255,255,255,0.06));align-items:start">
            <span style="color:${tone};font-weight:700;font-family:monospace">${mark}</span>
            <code style="font-size:11px;color:var(--text-primary)">${escHtml(d.name)}</code>
            <div>
                <div style="font-size:11px;color:var(--text-secondary);word-break:break-all">${d.sources.map((sv) => escHtml(sv)).join(' ') || '<em>(empty)</em>'}</div>
                ${d.risks.map((r) => `<div style="font-size:10px;color:${tone};margin-top:2px">${escHtml(r.source)} — ${escHtml(r.why)}</div>`).join('')}
            </div>
        </div>`;
}

/** The whole panel, as HTML. Wire it with `bindCspEditor` after inserting. */
export function renderCspEditor(): string {
    const shipped = parsePolicy(shippedPolicy());
    const severe = shipped.filter((d) => d.severe).length;
    const extra = savedExtra();

    return `
    <div class="setting-card" style="border:1px solid var(--bmm-danger);border-radius:10px;padding:14px;margin-top:12px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span style="font-size:13px;font-weight:700;color:var(--text-primary)">Content-Security-Policy</span>
            <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--bmm-danger);border:1px solid var(--bmm-danger);border-radius:4px;padding:1px 5px">Not recommended</span>
        </div>
        <p style="font-size:11px;color:var(--text-secondary);line-height:1.5;margin:0 0 10px">
            The policy decides what the app is allowed to load and run. Anything you add here is
            enforced <strong>on top of</strong> the shipped one, so it can only make BMM stricter —
            never looser. Get it wrong and parts of the app stop working; nothing here can make it
            less safe than it already is.
        </p>

        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:2px">
            Shipped policy — ${shipped.length} directives${severe ? `, <span style="color:var(--bmm-danger)">${severe} that permit code execution</span>` : ''}
        </div>
        <div id="csp-directives" style="max-height:220px;overflow:auto;margin-bottom:12px">
            ${shipped.map(directiveRow).join('')}
        </div>

        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:4px">Add a policy</div>
        <div id="csp-presets" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">
            ${PRESETS.map((p) => `<button type="button" class="btn btn-xs" data-csp-preset="${escHtml(p.id)}" title="${escHtml(p.note)}">${escHtml(p.label)}</button>`).join('')}
        </div>
        <textarea id="csp-extra" rows="4" spellcheck="false"
            placeholder="e.g. script-src 'self'; object-src 'none'"
            style="width:100%;font-family:monospace;font-size:11px;padding:8px;border-radius:6px;border:1px solid var(--border-subtle,rgba(255,255,255,0.12));background:var(--bg-input,rgba(0,0,0,0.25));color:var(--text-primary)">${escHtml(extra)}</textarea>
        <div id="csp-msg" style="font-size:11px;margin-top:6px;min-height:16px"></div>
        <div style="display:flex;gap:6px;margin-top:6px">
            <button type="button" id="csp-save" class="btn btn-xs btn-primary">Save</button>
            <button type="button" id="csp-clear" class="btn btn-xs">Remove my policy</button>
        </div>
        <p style="font-size:10px;color:var(--text-muted);margin:8px 0 0">
            Applies on the next launch. A policy is only read while the page is being parsed, so
            it cannot take effect on a screen you are already looking at.
        </p>
    </div>`;
}

/** Attach behaviour. Call once, after the panel is in the DOM. */
export function bindCspEditor(root: ParentNode = document): void {
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
            say(p.note, true);
        });
    });

    root.querySelector('#csp-save')?.addEventListener('click', () => {
        const err = validate(ta.value);
        if (err) return say(err, false);
        try {
            if (ta.value.trim()) localStorage.setItem(KEY, ta.value.trim());
            else localStorage.removeItem(KEY);
            say('Saved. Restart BMM for it to take effect.', true);
        } catch {
            say('Could not save — storage is unavailable.', false);
        }
    });

    root.querySelector('#csp-clear')?.addEventListener('click', () => {
        try { localStorage.removeItem(KEY); } catch { /* nothing to remove */ }
        ta.value = '';
        say('Removed. BMM will use its shipped policy on the next launch.', true);
    });
}
