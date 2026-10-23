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
    /**
     * Parameter names, per action and per condition.
     *
     * The half of an action nobody can remember. `do repo.syncNow(` takes TWELVE parameters
     * and the box offered none of them: you got the name completed and were then on your own
     * with a bracket, which is the exact moment the reference panel was three screens away.
     */
    params?: Record<string, string[]>;
}

/** The declared types, mirroring `canonical_type` in bmms.rs. */
export const TYPES = ['text', 'number', 'whole', 'decimal', 'yesno'];

/**
 * The words offered at the start of a statement.
 *
 * A deliberate SUBSET of `BMMS_KEYWORDS`, not a copy of it: that list is every word the
 * parser treats as grammar, `at` and `times` and `in` included, and offering those where a
 * statement begins would bury the twelve that belong there under thirty that do not.
 *
 * The cost is that it has to be edited when the grammar grows, and it once said it never
 * would — "fixed, because the grammar is fixed" — right up until the day three triggers
 * were added and it silently stopped offering them.
 */
export const KEYWORDS = [
    'do', 'if', 'else', 'for', 'in', 'repeat', 'times', 'while', 'until',
    'wait', 'waitfor', 'timeout', 'poll', 'orcontinue',
    'try', 'catch', 'switch', 'case', 'default', 'call',
    'break', 'continue', 'stop', 'set', 'shared', 'clear',
    'parallel', 'branch', 'settle', 'run', 'spawn', 'script',
    'and', 'or', 'not',
    // The trigger words. They sit at the same position as a statement — the first thing
    // inside `task "…" { … }` — which is where this list is offered.
    'after', 'when', 'probe',
];

/** Engines the `script` block accepts. */
export const ENGINES = ['powershell', 'cmd', 'bash', 'python', 'node', 'rust'];

export type CompletionKind =
    'action' | 'condition' | 'keyword' | 'source' | 'loop' | 'engine' | 'param' | 'variable' | 'type';
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

/**
 * The call the caret sits inside, if any: `do repo.sync(url: "x", | )` → `repo.sync`.
 *
 * Scanned backwards from the caret on the CURRENT line only, counting brackets, and it stops
 * at a quote so a `(` inside a string value does not open an imaginary call. A call spanning
 * two lines is not a thing BMMScript can write, so the line is the whole search space.
 */
function callAround(text: string, caret: number): { name: string; written: string[] } | null {
    const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
    const line = text.slice(lineStart, caret);
    let depth = 0;
    let open = -1;
    let inStr = false;
    for (let i = line.length - 1; i >= 0; i -= 1) {
        const c = line[i];
        if (c === '"' && line[i - 1] !== '\\') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === ')') depth += 1;
        else if (c === '(') {
            if (depth === 0) { open = i; break; }
            depth -= 1;
        }
    }
    if (open < 0) return null;
    const m = /([A-Za-z_][A-Za-z0-9_.]*)\s*$/.exec(line.slice(0, open));
    if (!m) return null;
    // Which parameters are already on the line, so the list does not offer them twice.
    const inside = line.slice(open + 1);
    const written = [...inside.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)].map((x) => x[1]);
    return { name: m[1], written };
}

/** Every variable the script has already named, in order of first appearance. */
function variablesIn(text: string, caret: number): string[] {
    const seen: string[] = [];
    const add = (n: string) => { if (n && !seen.includes(n)) seen.push(n); };
    // Only what is above the caret's OWN LINE. Two reasons, and the second is the one that
    // showed up in a test: a name three lines below does not exist yet at that point in the
    // run, and the half-typed `set tot` under the caret is not a definition — it matched the
    // pattern and offered `tot` back to the person typing it.
    const before = text.slice(0, text.lastIndexOf('\n', Math.max(0, caret - 1)) + 1);
    for (const m of before.matchAll(/(?:^|\n)\s*(?:shared\s+)?set\s+([A-Za-z_][A-Za-z0-9_]*)/g)) add(m[1]);
    for (const m of before.matchAll(/(?:^|\n)\s*for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\b/g)) add(m[1]);
    // `into:` is how an action names the variable it writes its result to.
    for (const m of before.matchAll(/\binto\s*:\s*"([A-Za-z_][A-Za-z0-9_]*)"/g)) add(m[1]);
    return seen;
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
    const prev = precedingToken(text, from);
    let pool: Completion[];

    // A declared type: `set n: |`. Offered from nothing, because there are five of them and
    // the colon is already an unambiguous request for one.
    const line = text.slice(text.lastIndexOf('\n', from - 1) + 1, from);
    if (/^\s*(shared\s+)?set\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*$/.test(line)
        || /^\s*(shared\s+)?set\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*[A-Za-z]*$/.test(line)) {
        const low0 = word.toLowerCase();
        const items = TYPES.filter((x) => x.startsWith(low0)).map((x) => ({ text: x, kind: 'type' as const }));
        return { from, to: caret, items: items.length === 1 && items[0].text === low0 ? [] : items };
    }

    // Inside a call's brackets, at a name position: the parameters of THAT action.
    //
    // Offered from zero characters, unlike everything else. `do repo.syncNow(` with the
    // caret after the bracket is a question with one answer, and making somebody type two
    // letters of a name they are trying to look up is the problem, not the guard.
    const call = callAround(text, from);
    if (call && !/[:"]\s*[^,]*$/.test(text.slice(text.lastIndexOf('(', from) + 1, from))) {
        const known = vocab.params?.[call.name];
        if (known?.length) {
            const low0 = word.toLowerCase();
            const items = known
                .filter((p) => !call.written.includes(p) || p.toLowerCase() === low0)
                .filter((p) => p.toLowerCase().startsWith(low0))
                .map((p) => ({ text: p, kind: 'param' as const }));
            return { from, to: caret, items: items.length === 1 && items[0].text.toLowerCase() === low0 ? [] : items };
        }
    }

    // Two characters, unless the person asked for the list outright.
    if (!force && word.length < 2) return none;

    if (prev === 'do') {
        pool = vocab.actions.map((a) => ({ text: a, kind: 'action' as const }));
    } else if (prev === 'script') {
        pool = ENGINES.map((e) => ({ text: e, kind: 'engine' as const }));
    } else if (prev === 'in') {
        pool = vocab.loops.map((l) => ({ text: l, kind: 'loop' as const }));
    } else if (['if', 'case', 'waitfor', 'while', 'until', 'and', 'or', 'not'].includes(prev)) {
        // A condition slot. Sources belong here too: `if disk.free_gb < 5` is a comparison,
        // and the left-hand side of one is a source, not a condition. So do the script's own
        // variables — `if count > 3` reads one, and nothing offered it.
        pool = [
            ...vocab.conditions.map((c) => ({ text: c, kind: 'condition' as const })),
            ...vocab.sources.map((s) => ({ text: s, kind: 'source' as const })),
            ...variablesIn(text, from).map((v) => ({ text: v, kind: 'variable' as const })),
        ];
    } else {
        // Start of a statement, or something we cannot place: keywords, sources, and the
        // variables this script has already named — which are most of what the right-hand
        // side of a `set` is made of, and the one pool the box could not possibly ship.
        pool = [
            ...KEYWORDS.map((k) => ({ text: k, kind: 'keyword' as const })),
            ...vocab.sources.map((s) => ({ text: s, kind: 'source' as const })),
            ...variablesIn(text, from).map((v) => ({ text: v, kind: 'variable' as const })),
        ];
    }

    const low = word.toLowerCase();
    // Prefix first, then anywhere, then in-order letters — `mods.scan` should still surface
    // for "scan", but below anything that actually starts with it, and `repo.syncNow` should
    // be reachable as "rsn" without being ranked above a real prefix match.
    const starts = pool.filter((c) => c.text.toLowerCase().startsWith(low));
    const contains = pool.filter((c) => !c.text.toLowerCase().startsWith(low) && c.text.toLowerCase().includes(low));
    //
    // The loose tier only runs when the other two found NOTHING. Added to a list that
    // already has matches it is noise with a rank: `if onl` answered `online` correctly and
    // then offered `modEnabled` under it, because o…n…l appear in that order.
    const loose = (low.length >= 3 && !starts.length && !contains.length)
        ? pool.filter((c) => {
            const n = c.text.toLowerCase();
            let i = 0;
            for (const ch of n) if (ch === low[i]) i += 1;
            return i === low.length;
        })
        : [];
    let items = [...starts, ...contains, ...loose].slice(0, 12);

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
    param: 'parameter', variable: 'variable', type: 'type',
};

/**
 * What the highlighted item is, in one line.
 *
 * Supplied by the caller because the descriptions live in the app's i18n and this module is
 * deliberately importable by a Node test. Return an empty string for "nothing to say" — the
 * footer then shows the keys instead, rather than an empty strip that looks broken.
 */
export type Describe = (c: Completion) => string;

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
export function mountCompletions(ta: HTMLTextAreaElement, vocab: Vocabulary, describe?: Describe): () => void {
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
        const esc = (x: string) => x.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch] as string);
        // The line under the list: what the highlighted thing IS. Without it the panel names
        // eighty-two actions and explains none of them, which is a list you still have to
        // leave the editor to understand.
        const said = describe?.(items[sel]) || '';
        panel.innerHTML = items.map((c, i) => `
            <div class="bmms-ac-row${i === sel ? ' on' : ''}" role="option" aria-selected="${i === sel}" data-i="${i}">
                <span class="bmms-ac-text">${esc(c.text)}</span>
                <span class="bmms-ac-kind">${KIND_LABEL[c.kind]}</span>
            </div>`).join('')
            + (said ? `<div class="bmms-ac-doc">${esc(said)}</div>` : '')
            + `<div class="bmms-ac-foot"><span>Tab ↑↓ Esc</span></div>`;
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
        // What you were going to type next, per kind: a bracket after an action, a colon and
        // a space after a parameter name, nothing at all when the character is already there.
        // None of these is ever wrong for its kind, which is the bar for typing something on
        // somebody's behalf.
        const tail = c.kind === 'action' ? (after.startsWith('(') ? '' : '(')
            : c.kind === 'param' ? (/^\s*:/.test(after) ? '' : ': ')
            : ' ';
        ta.value = before + c.text + tail + after;
        const caret = (before + c.text + tail).length;
        ta.setSelectionRange(caret, caret);
        closePanel();
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        // An action's brackets are a question with a known answer list. Open it.
        if (c.kind === 'action') setTimeout(() => refresh(true), 0);
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
