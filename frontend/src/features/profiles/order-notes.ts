// A saved order list's notes: rendered (full B.MD, diagrams included) and edited (a large
// editor with the source and a live preview side by side).
//
// ── Two trust levels ───────────────────────────────────────────────────────────────────────
//
// `withGlobalTauri` is on: anything that runs in this webview can call every command the app
// has. A list's notes may come from somebody else (a code, a link, a .bmmorder file); such a
// list carries `imported` for good (order_lists.rs), and its notes take the untrusted path:
//
//   * own notes      md-lite's markup, sanitised (md-safe.ts): no raw HTML, no script, ever.
//                    Images and media the author linked are shown.
//   * imported notes md-lite's markup with every network fetch taken out first (an image
//                    becomes its alt text; video, audio, frames, embeds and CDN icons go:
//                    order-notes-model.ts `offlineMarkup`), THEN sanitised, THEN a DOM pass
//                    that removes anything that could still fetch (`scrubFetches`).
//
// Both draw diagrams with mermaid at `securityLevel: 'strict'` (no click callbacks into the
// page, labels sanitised); an imported list's SVG goes through the same DOM pass before it is
// inserted. Tables, callouts, steps, tabs, code, maths (KaTeX, bundled) all render: none of
// them needs the network.
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { dialog } from './order-share.js';
import {
    NOTES_MAX, notesLength, notesFill, offlineMarkup, applyFormat, FORMAT_KEYS, type FormatKind,
} from './order-notes-model.js';

interface Renderer {
    renderDocMarkup: (src: string) => string;
    sanitizeDocHtml: (html: string) => string;
    hydrateMdLite: (host: HTMLElement) => void;
    drawDiagrams: (host: HTMLElement, opts?: { strict?: boolean; scrub?: (svg: string) => string }) => Promise<number>;
    highlightIn: (root: ParentNode) => void;
}

let md: Renderer | null = null;
let loading: Promise<boolean> | null = null;

/** Load the renderer once (md-lite and its helpers). False: the notes show as plain text. */
export function loadNotesRenderer(): Promise<boolean> {
    if (md) return Promise.resolve(true);
    loading ??= (async () => {
        try {
            const [lite, safe, hyd, mmd, hl] = await Promise.all([
                import('../../docs/md-lite.js'),
                import('../../docs/md-safe.js'),
                import('../../docs/md-hydrate.js'),
                import('../../docs/md-mermaid.js'),
                import('../../ui/code-highlight.js'),
            ]);
            md = {
                renderDocMarkup: lite.renderDocMarkup,
                sanitizeDocHtml: safe.sanitizeDocHtml,
                hydrateMdLite: hyd.hydrateMdLite,
                drawDiagrams: mmd.drawDiagrams,
                highlightIn: hl.highlightIn,
            };
            return true;
        } catch {
            return false;
        }
    })();
    return loading;
}

/** Elements that fetch, removed from an imported list's rendered notes (and its diagrams). */
const FETCHERS = 'img, image, iframe, frame, video, audio, source, track, picture, object, embed, link, meta, base, script, style';

/**
 * The last net under an imported list's notes, on the DOM: nothing that fetches survives (an
 * image leaves its alt text), no `src`/`srcset`/`poster`, no style that loads a URL, no
 * `on*` handler, and no link inside a drawing (an SVG `<a>` would navigate the app's window).
 */
export function scrubFetches(root: ParentNode): void {
    root.querySelectorAll(FETCHERS).forEach((el) => {
        const alt = el.tagName.toLowerCase() === 'img' ? (el.getAttribute('alt') || '') : '';
        if (alt) el.replaceWith(document.createTextNode(alt)); else el.remove();
    });
    root.querySelectorAll('*').forEach((el) => {
        for (const a of [...el.attributes]) {
            const n = a.name.toLowerCase();
            const fetches = n === 'src' || n === 'srcset' || n === 'poster' || n === 'background' || n === 'data-src' || n === 'data-lucide' || n === 'data-ph';
            const styled = n === 'style' && /url\s*\(|image-set\s*\(|@import/i.test(a.value);
            const svgLink = (n === 'href' || n === 'xlink:href') && !!el.closest('svg') && !a.value.startsWith('#');
            if (fetches || styled || svgLink || n.startsWith('on')) el.removeAttribute(a.name);
        }
    });
}

function scrubSvg(svg: string): string {
    const tpl = document.createElement('template');
    tpl.innerHTML = svg;
    scrubFetches(tpl.content);
    return tpl.innerHTML;
}

/** Notes as HTML, by trust level. Without the renderer: the source as escaped text. */
export function notesHtml(src: string, imported: boolean): string {
    const text = String(src || '').trim();
    if (!text) return '';
    if (!md) return `<pre class="olm-md-plain">${escHtml(text)}</pre>`;
    // Both paths sanitise; the imported one takes every fetch out first. The diagram sources
    // survive the sanitiser on their own (md-safe.ts `stashDiagrams`, for every sanitised render).
    const markup = md.renderDocMarkup(text);
    const tpl = document.createElement('template');
    tpl.innerHTML = md.sanitizeDocHtml(imported ? offlineMarkup(markup) : markup);
    if (imported) scrubFetches(tpl.content);
    return tpl.innerHTML;
}

/** What the renderer left for the page to do: tabs, schedules, maths, code colours, diagrams. */
export function hydrateNotes(host: HTMLElement, imported: boolean): void {
    if (!md) return;
    try { md.hydrateMdLite(host); } catch { /* the text is there; only the extras are missing */ }
    try { md.highlightIn(host); } catch { /* plain code */ }
    if (imported) scrubFetches(host);
    void md.drawDiagrams(host, { strict: true, scrub: imported ? scrubSvg : undefined }).catch(() => 0);
}

/** Render `src` into `host`, hydrated. */
export function paintNotes(host: HTMLElement, src: string, imported: boolean): void {
    host.innerHTML = notesHtml(src, imported);
    hydrateNotes(host, imported);
}

// ── The editor ─────────────────────────────────────────────────────────────────────────────

export interface NotesEditorOpts {
    /** The list's name, for the title. */
    listName: string;
    value: string;
    imported: boolean;
    /** Open on the rendered notes alone (the "expand" view); the editor is one click away. */
    readOnly?: boolean;
    /** Every change, as typed: the list's draft keeps it, so closing never loses anything. */
    onInput: (value: string) => void;
    /** Save the list (the dialog's own Save); resolves with whether it worked. */
    onSave?: () => Promise<boolean>;
    /** The dialog closed. */
    onClose?: () => void;
}

type View = 'split' | 'source' | 'preview';

const ic = (body: string) => `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const GLYPH: Record<FormatKind, string> = {
    h2: '<b class="olmn-g">H2</b>',
    h3: '<b class="olmn-g">H3</b>',
    bold: '<b class="olmn-g">B</b>',
    italic: '<i class="olmn-g olmn-g-i">I</i>',
    strike: '<s class="olmn-g">S</s>',
    code: ic('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'),
    link: ic('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
    ul: ic('<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'),
    ol: ic('<line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>'),
    task: ic('<rect x="3" y="5" width="6" height="6" rx="1"/><path d="m3 17 2 2 4-4"/><line x1="13" y1="8" x2="21" y2="8"/><line x1="13" y1="17" x2="21" y2="17"/>'),
    quote: ic('<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>'),
    codeblock: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><polyline points="10 10 8 12 10 14"/><polyline points="14 10 16 12 14 14"/>'),
    table: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="4" x2="12" y2="20"/>'),
    hr: ic('<line x1="3" y1="12" x2="21" y2="12"/>'),
    note: ic('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>'),
    tip: ic('<path d="M9 18h6"/><path d="M10 22h4"/><path d="M8.5 14.5A6 6 0 1 1 15.5 14.5c-.8.7-1.5 1.6-1.5 2.5h-4c0-.9-.7-1.8-1.5-2.5z"/>'),
    warning: ic('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
    danger: ic('<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>'),
    details: ic('<polyline points="9 6 15 12 9 18"/>'),
    steps: ic('<circle cx="5" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><path d="M5 8v8"/><line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="18" x2="20" y2="18"/>'),
    mermaid: ic('<rect x="3" y="3" width="7" height="6" rx="1"/><rect x="14" y="15" width="7" height="6" rx="1"/><path d="M6.5 9v3a2 2 0 0 0 2 2h7a2 2 0 0 1 2 2v-1"/>'),
    math: '<b class="olmn-g">∑</b>',
};
const GROUPS: FormatKind[][] = [
    ['h2', 'h3'],
    ['bold', 'italic', 'strike', 'code', 'link'],
    ['ul', 'ol', 'task', 'quote'],
    ['codeblock', 'table', 'hr', 'math'],
    ['note', 'tip', 'warning', 'danger'],
    ['details', 'steps', 'mermaid'],
];

function fillCount(n: number): string {
    return t('orderList.notesCount').split('{n}').join(n.toLocaleString()).split('{m}').join(NOTES_MAX.toLocaleString());
}

/** The large notes editor: toolbar, source and live preview side by side, preview alone. */
export function openNotesEditor(o: NotesEditorOpts): { close: () => void } {
    let value = o.value;
    let view: View = o.readOnly ? 'preview' : 'split';
    let editing = !o.readOnly;
    const title = t('orderList.notesEditorTitle').split('{m}').join(o.listName || t('orderList.untitled'));
    const { ov, close, onClose } = dialog('olmn', title, '<div class="olmn"></div>', '<div class="olmn-foot"></div>');
    ov.querySelector('.osh-modal')?.classList.add('olmn-modal');
    onClose(() => o.onClose?.());
    const root = ov.querySelector('.olmn') as HTMLElement;
    const foot = ov.querySelector('.olmn-foot') as HTMLElement;
    let status = '';
    let timer = 0;

    const trust = o.imported
        ? `<span class="olmn-trust" title="${escAttr(t('orderList.importedTip'))}">${ic('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>')}<span>${escHtml(t('orderList.importedBadge'))}</span></span>`
        : '';

    function bar(): string {
        const tools = GROUPS.map((g) => `<div class="olmn-group" role="group">${g.map((k) => {
            const label = t(`orderList.fmt.${k}`);
            return `<button type="button" class="olmn-tool" data-fmt="${k}" title="${escAttr(label)}" aria-label="${escAttr(label)}">${GLYPH[k]}</button>`;
        }).join('')}</div>`).join('');
        const seg = (['source', 'split', 'preview'] as const).map((v) => `<button type="button" class="olmn-view${view === v ? ' is-on' : ''}" data-view="${v}" aria-pressed="${view === v}">${escHtml(t(`orderList.view.${v}`))}</button>`).join('');
        return `<div class="olmn-bar">
            <div class="olmn-tools" role="toolbar" aria-label="${escAttr(t('orderList.fmt.bar'))}">${tools}</div>
            <span class="bms-spacer"></span>
            ${trust}
            <div class="olmn-views" role="group" aria-label="${escAttr(t('orderList.view.label'))}">${seg}</div>
          </div>`;
    }

    function layout(): void {
        root.innerHTML = editing ? `
            ${bar()}
            <div class="olmn-panes is-${view}">
              <div class="olmn-pane olmn-pane-src">
                <label class="olmn-pane-h bms-label" for="olmn-src">${escHtml(t('orderList.view.source'))}</label>
                <textarea id="olmn-src" class="form-input olmn-src" spellcheck="true" placeholder="${escAttr(t('orderList.notesPlaceholder'))}">${escHtml(value)}</textarea>
              </div>
              <div class="olmn-pane olmn-pane-pv">
                <span class="olmn-pane-h bms-label">${escHtml(t('orderList.notesPreview'))}</span>
                <div class="olmn-preview dh-content" aria-live="off"></div>
              </div>
            </div>`
            : `<div class="olmn-bar olmn-bar-read"><span class="bms-spacer"></span>${trust}</div>
               <div class="olmn-panes is-preview"><div class="olmn-pane olmn-pane-pv"><div class="olmn-preview olmn-read dh-content"></div></div></div>`;
        preview();
        renderFoot();
    }

    function preview(): void {
        const pv = root.querySelector<HTMLElement>('.olmn-preview');
        if (!pv) return;
        const top = pv.scrollTop;
        if (value.trim()) paintNotes(pv, value, o.imported);
        else pv.innerHTML = `<p class="osh-note">${escHtml(t('orderList.notesEmpty'))}</p>`;
        pv.scrollTop = top;
    }

    function renderFoot(): void {
        const n = notesLength(value);
        const fillState = notesFill(n);
        const over = fillState === 'over';
        foot.innerHTML = `
            ${editing ? `<span class="olmn-count is-${fillState}" title="${escAttr(t('orderList.notesCountTip'))}">${escHtml(fillCount(n))}</span>` : ''}
            <span class="osh-status olmn-status" aria-live="polite">${escHtml(over ? t('orderList.errNotesTooLong') : status)}</span>
            ${!editing ? `<button type="button" class="btn btn-secondary btn-sm olmn-edit">${escHtml(t('orderList.notesEdit'))}</button>` : ''}
            ${editing && o.onSave ? `<button type="button" class="btn btn-secondary btn-sm olmn-save"${over ? ' disabled' : ''}>${escHtml(t('orderList.save'))}</button>` : ''}
            <button type="button" class="btn btn-primary btn-sm olmn-done">${escHtml(t('orderList.notesClose'))}</button>`;
    }

    function updateCount(): void {
        const el = foot.querySelector<HTMLElement>('.olmn-count');
        const n = notesLength(value);
        const state = notesFill(n);
        if (el) { el.textContent = fillCount(n); el.className = `olmn-count is-${state}`; }
        const st = foot.querySelector<HTMLElement>('.olmn-status');
        if (st) st.textContent = state === 'over' ? t('orderList.errNotesTooLong') : status;
        const save = foot.querySelector<HTMLButtonElement>('.olmn-save');
        if (save) save.disabled = state === 'over';
    }

    function set(next: string): void {
        value = next;
        o.onInput(value);
        updateCount();
        window.clearTimeout(timer);
        timer = window.setTimeout(preview, 160);
    }

    function format(kind: FormatKind): void {
        const ta = root.querySelector<HTMLTextAreaElement>('#olmn-src');
        if (!ta) return;
        const r = applyFormat(ta.value, ta.selectionStart, ta.selectionEnd, kind, {
            text: t('orderList.fmt.wText'), url: 'https://', title: t('orderList.fmt.wTitle'), code: t('orderList.fmt.wCode'),
        });
        ta.focus();
        // setRangeText keeps the field's undo history in the webviews that support it.
        ta.setSelectionRange(0, ta.value.length);
        ta.setRangeText(r.value, 0, ta.value.length, 'preserve');
        ta.setSelectionRange(r.start, r.end);
        set(ta.value);
    }

    root.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
        if (!b) return;
        if (b.dataset.fmt) { format(b.dataset.fmt as FormatKind); return; }
        if (b.dataset.view) {
            view = b.dataset.view as View;
            const panes = root.querySelector<HTMLElement>('.olmn-panes');
            if (panes) panes.className = `olmn-panes is-${view}`;
            root.querySelectorAll<HTMLButtonElement>('.olmn-view').forEach((x) => {
                const on = x.dataset.view === view;
                x.classList.toggle('is-on', on);
                x.setAttribute('aria-pressed', String(on));
            });
            if (view !== 'preview') root.querySelector<HTMLTextAreaElement>('#olmn-src')?.focus();
        }
    });
    root.addEventListener('input', (e) => {
        const ta = e.target as HTMLTextAreaElement;
        if (ta.id === 'olmn-src') set(ta.value);
    });
    root.addEventListener('keydown', (e) => {
        const ta = e.target as HTMLTextAreaElement;
        if (ta.id !== 'olmn-src' || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
        const kind = FORMAT_KEYS[e.key.toLowerCase()];
        if (kind) { e.preventDefault(); e.stopPropagation(); format(kind); }
    });
    foot.addEventListener('click', async (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
        if (!b) return;
        if (b.classList.contains('olmn-done')) close();
        else if (b.classList.contains('olmn-edit')) { editing = true; view = 'split'; layout(); root.querySelector<HTMLTextAreaElement>('#olmn-src')?.focus(); }
        else if (b.classList.contains('olmn-save') && o.onSave) {
            b.disabled = true;
            status = t('orderList.saving');
            updateCount();
            const ok = await o.onSave();
            status = ok ? t('orderList.saved') : t('orderList.saveFailed');
            if (ov.isConnected) { updateCount(); b.disabled = notesFill(notesLength(value)) === 'over'; }
        }
    });

    layout();
    const ta = root.querySelector<HTMLTextAreaElement>('#olmn-src');
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    else foot.querySelector<HTMLElement>('.olmn-edit, .olmn-done')?.focus();
    return { close };
}
