/**
 * bmms-complete.ts — completion for the BMMScript box.
 *
 * The design goal is a list that helps and then gets out of the way. Every rule here exists
 * because the opposite is what makes completion hateful to type into:
 *
 *   · **Enter never accepts.** Enter means newline, always. A completer that steals it turns
 *     "finish this line and start the next" into a lottery, and the cost of being wrong is a
 *     word you did not want, in code you now have to go back and fix. Tab accepts; nothing
 *     else does.
 *   · **It only opens where a name can go.** After `do `, in a condition, at the start of a
 *     statement. Inside a string, or inside a `script` body, it stays shut — a list of BMM
 *     action names over a Python body is pure noise.
 *   · **It never opens on one character.** Two, so a stray keystroke does not raise a panel.
 *   · **It suggests nothing when the word is already exactly an item.** You have typed it; a
 *     panel confirming that is in the way of the bracket you were about to type.
 *
 * `completionsFor` is pure and takes the vocabulary as an argument: the registry lives in
 * scheduler.ts, and a copy of 75 action names here would be a second list to keep in step.
 */

/** What the box knows about. Supplied by the caller from the real registry. */
export interface Vocabulary {
    actions: string[];
    conditions: string[];
    /** Values a `value` condition can read — disk.free_gb and friends. */
    sources: string[];
    /** What `for x in …` can walk. */
    loops: string[];
}

/** Statement keywords. Fixed, because the grammar is fixed — unlike the action list. */
export const KEYWORDS = [
    'do', 'if', 'else', 'for', 'in', 'repeat', 'times', 'while', 'until',
    'wait', 'waitfor', 'timeout', 'poll', 'orcontinue',
    'try', 'catch', 'switch', 'case', 'default', 'call',
    'break', 'continue', 'stop', 'set', 'shared', 'clear',
    'parallel', 'branch', 'settle', 'run', 'spawn', 'script',
    'and', 'or', 'not',
];

/** Engines the `script` block accepts. */
export const ENGINES = ['powershell', 'cmd', 'bash', 'python', 'node', 'rust'];

export type CompletionKind = 'action' | 'condition' | 'keyword' | 'source' | 'loop' | 'engine';
export interface Completion { text: string; kind: CompletionKind }
export interface CompletionResult {
    /** Where the word being completed starts, so accepting replaces it rather than appending. */
    from: number;
    to: number;
    items: Completion[];
}

/** The word immediately before the caret, and where it starts. */
function wordAt(text: string, caret: number): { word: string; from: number } {
    let i = caret;
    while (i > 0 && /[A-Za-z0-9_.]/.test(text[i - 1])) i -= 1;
    return { word: text.slice(i, caret), from: i };
}

/**
 * Is the caret somewhere a suggestion would be noise?
 *
 * Counted from the top of the file rather than by looking backwards for the nearest quote: a
 * `"` earlier in the file decides whether THIS position is inside a string, and no amount of
 * looking at the current line can see that.
 */
function inDeadZone(text: string, caret: number): boolean {
    let inStr = false;
    let scriptDepth = 0;     // brace depth of the `script` body we are in, 0 = not in one
    let braceDepth = 0;
    let i = 0;
    while (i < caret) {
        const c = text[i];
        if (inStr) {
            if (c === '\\') { i += 2; continue; }
            if (c === '"') inStr = false;
            i += 1;
            continue;
        }
        if (c === '"') { inStr = true; i += 1; continue; }
        if (c === '/' && text[i + 1] === '/') { while (i < caret && text[i] !== '\n') i += 1; continue; }
        if (c === '#') { while (i < caret && text[i] !== '\n') i += 1; continue; }
        if (c === '{') {
            braceDepth += 1;
            // `script <engine> {` opens a body that is not BMMScript at all.
            if (!scriptDepth && /\bscript\s+\w+\s*$/.test(text.slice(Math.max(0, i - 40), i))) {
                scriptDepth = braceDepth;
            }
        } else if (c === '}') {
            if (scriptDepth && braceDepth === scriptDepth) scriptDepth = 0;
            braceDepth -= 1;
        }
        i += 1;
    }
    return inStr || scriptDepth > 0;
}

/** The token before the word being typed, lowercased. Empty at the start of a line. */
function precedingToken(text: string, from: number): string {
    const before = text.slice(0, from).replace(/[ \t]+$/, '');
    const m = /([A-Za-z_][A-Za-z0-9_.]*)$/.exec(before);
    return m ? m[1].toLowerCase() : '';
}

/**
 * What could go here.
 *
 * Returns an empty item list rather than null when there is nothing to offer, so a caller
 * never has to tell "no suggestions" from "did not look".
 */
export function completionsFor(text: string, caret: number, vocab: Vocabulary, force = false): CompletionResult {
    const none: CompletionResult = { from: caret, to: caret, items: [] };
    if (caret < 0 || caret > text.length) return none;
    if (inDeadZone(text, caret)) return none;

    const { word, from } = wordAt(text, caret);
    // Two characters, unless the person asked for the list outright.
    if (!force && word.length < 2) return none;

    const prev = precedingToken(text, from);
    let pool: Completion[];

    if (prev === 'do') {
        pool = vocab.actions.map((a) => ({ text: a, kind: 'action' as const }));
    } else if (prev === 'script') {
        pool = ENGINES.map((e) => ({ text: e, kind: 'engine' as const }));
    } else if (prev === 'in') {
        pool = vocab.loops.map((l) => ({ text: l, kind: 'loop' as const }));
    } else if (['if', 'case', 'waitfor', 'while', 'until', 'and', 'or', 'not'].includes(prev)) {
        // A condition slot. Sources belong here too: `if disk.free_gb < 5` is a comparison,
        // and the left-hand side of one is a source, not a condition.
        pool = [
            ...vocab.conditions.map((c) => ({ text: c, kind: 'condition' as const })),
            ...vocab.sources.map((s) => ({ text: s, kind: 'source' as const })),
        ];
    } else {
        // Start of a statement, or something we cannot place: keywords, plus sources, which
        // are what the right-hand side of a `set` is made of.
        pool = [
            ...KEYWORDS.map((k) => ({ text: k, kind: 'keyword' as const })),
            ...vocab.sources.map((s) => ({ text: s, kind: 'source' as const })),
        ];
    }

    const low = word.toLowerCase();
    // Prefix first, then anywhere — `mods.scan` should still surface for "scan", but below
    // anything that actually starts with it.
    const starts = pool.filter((c) => c.text.toLowerCase().startsWith(low));
    const contains = pool.filter((c) => !c.text.toLowerCase().startsWith(low) && c.text.toLowerCase().includes(low));
    let items = [...starts, ...contains].slice(0, 12);

    // Already exactly right, and nothing else shares the prefix: the panel would only be in
    // the way of whatever comes next.
    if (items.length === 1 && items[0].text.toLowerCase() === low) items = [];

    return { from, to: caret, items };
}

// ── The panel ────────────────────────────────────────────────────────────────
// Everything below is DOM. The decision of WHAT to show is above and pure; this only draws
// it, so the rules can be tested without a browser.

const KIND_LABEL: Record<CompletionKind, string> = {
    action: 'action', condition: 'condition', keyword: 'keyword',
    source: 'value', loop: 'list', engine: 'engine',
};

/** Caret position in pixels, via a mirror div. A textarea will not tell you otherwise. */
function caretXY(ta: HTMLTextAreaElement, index: number): { x: number; y: number } {
    const st = getComputedStyle(ta);
    const mirror = document.createElement('div');
    // Every property that affects where a character lands. Miss one and the panel sits a
    // line off, which looks like a bug in the completion rather than in the measuring.
    for (const k of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'borderTopWidth', 'borderLeftWidth', 'textIndent', 'whiteSpace', 'wordWrap', 'tabSize'] as const) {
        (mirror.style as any)[k] = (st as any)[k];
    }
    mirror.style.position = 'absolute';
    mirror.style.visibility = 'hidden';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.wordWrap = 'break-word';
    mirror.style.width = `${ta.clientWidth}px`;
    mirror.textContent = ta.value.slice(0, index);
    const marker = document.createElement('span');
    marker.textContent = '\u200b';
    mirror.appendChild(marker);
    document.body.appendChild(mirror);
    const top = marker.offsetTop;
    const left = marker.offsetLeft;
    mirror.remove();
    const r = ta.getBoundingClientRect();
    return { x: r.left + left - ta.scrollLeft, y: r.top + top - ta.scrollTop };
}

/**
 * Attach completion to a textarea. Returns a teardown, because the editor modal is rebuilt
 * and a panel outliving its box would float over the next screen.
 */
export function mountCompletions(ta: HTMLTextAreaElement, vocab: Vocabulary): () => void {
    let panel: HTMLElement | null = null;
    let items: Completion[] = [];
    let sel = 0;
    let range = { from: 0, to: 0 };

    const closePanel = () => { panel?.remove(); panel = null; items = []; };

    const draw = () => {
        if (!items.length) { closePanel(); return; }
        if (!panel) {
            panel = document.createElement('div');
            panel.className = 'bmms-ac';
            panel.setAttribute('role', 'listbox');
            document.body.appendChild(panel);
        }
        panel.innerHTML = items.map((c, i) => `
            <div class="bmms-ac-row${i === sel ? ' on' : ''}" role="option" aria-selected="${i === sel}" data-i="${i}">
                <span class="bmms-ac-text">${c.text.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch] as string)}</span>
                <span class="bmms-ac-kind">${KIND_LABEL[c.kind]}</span>
            </div>`).join('') + `<div class="bmms-ac-foot">Tab</div>`;
        for (const row of Array.from(panel.querySelectorAll('.bmms-ac-row'))) {
            // mousedown, not click: click fires after the textarea has already lost focus.
            row.addEventListener('mousedown', (e) => {
                e.preventDefault();
                accept(Number((row as HTMLElement).dataset.i));
            });
        }
        const { x, y } = caretXY(ta, range.from);
        const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
        panel.style.left = `${Math.min(x, window.innerWidth - 240)}px`;
        // Below the line normally; above it when there is no room, so the list is never
        // half off the bottom of a short modal.
        const h = panel.offsetHeight;
        panel.style.top = (y + lh + h > window.innerHeight)
            ? `${Math.max(4, y - h - 2)}px`
            : `${y + lh + 2}px`;
    };

    const accept = (i: number) => {
        const c = items[i];
        if (!c) return;
        const before = ta.value.slice(0, range.from);
        const after = ta.value.slice(range.to);
        // A trailing space for a keyword, an opening bracket for an action: both are what
        // you were going to type next, and neither is ever wrong for its kind.
        const tail = c.kind === 'action' ? '(' : ' ';
        ta.value = before + c.text + tail + after;
        const caret = (before + c.text + tail).length;
        ta.setSelectionRange(caret, caret);
        closePanel();
        ta.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const refresh = (force = false) => {
        const r = completionsFor(ta.value, ta.selectionStart, vocab, force);
        items = r.items;
        range = { from: r.from, to: r.to };
        sel = 0;
        draw();
    };

    const onInput = () => refresh();
    const onKey = (e: KeyboardEvent) => {
        if (e.key === ' ' && e.ctrlKey) { e.preventDefault(); refresh(true); return; }
        if (!panel) return;
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePanel(); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % items.length; draw(); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % items.length; draw(); return; }
        if (e.key === 'Tab') { e.preventDefault(); accept(sel); return; }
        // Enter is deliberately absent. It means newline here, and it always will.
        if (e.key === 'Enter') closePanel();
    };

    ta.addEventListener('input', onInput);
    ta.addEventListener('keydown', onKey);
    ta.addEventListener('blur', closePanel);
    ta.addEventListener('scroll', closePanel);
    return () => {
        ta.removeEventListener('input', onInput);
        ta.removeEventListener('keydown', onKey);
        ta.removeEventListener('blur', closePanel);
        ta.removeEventListener('scroll', closePanel);
        closePanel();
    };
}
