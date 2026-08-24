// A tiny condition language for tutorial steps, with no eval in it.
//
// WHY THIS EXISTS. The first version of "write your own condition" took a JavaScript
// expression and ran it with `new Function`. It looked fine in a devtools probe and did not
// work in the app at all: the devtools evaluation context is exempt from the page's
// Content-Security-Policy, the page is not, and BMM's policy has no 'unsafe-eval'. Every
// custom condition failed silently with a console warning nobody would read.
//
// The fix was not to weaken the policy. `'unsafe-eval'` is a real reduction in what the app
// can promise about a downloaded theme, a plugin, or an imported lesson, and buying it with
// a tutorial convenience is a bad trade. So the condition is parsed and evaluated here
// instead, over a vocabulary that cannot do anything except look at the DOM.
//
// It also happens to be the safer answer to the thing that worried me about the JS version:
// a lesson somebody else wrote can now be READ. `count('.mod-row') > 3` says what it does;
// an arbitrary function body does not.
//
// GRAMMAR
//   expr    := or
//   or      := and ( 'or' and )*
//   and     := unary ( 'and' unary )*
//   unary   := 'not' unary | '(' expr ')' | comparison
//   compare := term ( op value )?
//   term    := name '(' selector ')'
//   op      := '==' | '!=' | '>' | '>=' | '<' | '<=' | 'contains'
//   value   := number | 'single-quoted' | "double-quoted"
//
// A term with no comparison is truthy on its own: `visible('#x')`, `count('.y')`.

export type ExprFn = () => boolean;

const TERMS: Record<string, (sel: string) => number | string | boolean> = {
    /** How many match. */
    count: (sel) => document.querySelectorAll(sel).length,
    /** The first match's text, trimmed. Missing element → empty string, never a throw. */
    text: (sel) => (document.querySelector(sel)?.textContent || '').trim(),
    /** An input's value. */
    value: (sel) => String((document.querySelector(sel) as HTMLInputElement | null)?.value ?? ''),
    /** Present in the DOM at all. */
    exists: (sel) => !!document.querySelector(sel),
    /** Present AND actually shown — this app keeps its dialogs in the DOM and hides them,
     *  so `exists` answers yes for every modal in the application. */
    visible: (sel) => {
        const n = document.querySelector(sel) as HTMLElement | null;
        if (!n) return false;
        const cs = getComputedStyle(n);
        return cs.display !== 'none' && cs.visibility !== 'hidden';
    },
    /** Not disabled, by any of the three ways this app says so. */
    enabled: (sel) => {
        const n = document.querySelector(sel) as HTMLElement | null;
        if (!n) return false;
        return !(n as HTMLButtonElement).disabled
            && n.getAttribute('aria-disabled') !== 'true'
            && !n.classList.contains('disabled');
    },
};

export const EXPR_TERMS = Object.keys(TERMS);

interface Tok { t: 'name' | 'op' | 'num' | 'str' | 'punc' | 'kw'; v: string }

function lex(src: string): Tok[] {
    const out: Tok[] = [];
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        if (/\s/.test(c)) { i++; continue; }
        if (c === '(' || c === ')' || c === ',') { out.push({ t: 'punc', v: c }); i++; continue; }
        // Two-character operators first, or `>=` lexes as `>` followed by a stray `=`.
        const two = src.slice(i, i + 2);
        if (['==', '!=', '>=', '<='].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
        if (c === '>' || c === '<') { out.push({ t: 'op', v: c }); i++; continue; }
        if (c === '"' || c === "'") {
            const end = src.indexOf(c, i + 1);
            if (end < 0) throw new Error('unterminated string');
            out.push({ t: 'str', v: src.slice(i + 1, end) });
            i = end + 1;
            continue;
        }
        const num = /^\d+(\.\d+)?/.exec(src.slice(i));
        if (num) { out.push({ t: 'num', v: num[0] }); i += num[0].length; continue; }
        const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
        if (word) {
            const w = word[0].toLowerCase();
            out.push({ t: ['and', 'or', 'not', 'contains'].includes(w) ? 'kw' : 'name', v: w === 'contains' ? w : word[0] });
            i += word[0].length;
            continue;
        }
        throw new Error(`unexpected character "${c}"`);
    }
    return out;
}

/**
 * Parse a condition into a function that answers it, or throw with a readable reason.
 *
 * Throwing on a BAD expression is deliberate — the editor shows the message while the author
 * is typing. Once compiled, evaluation never throws: a selector that matches nothing is
 * "not yet", not an error, because the whole point is to wait for something that is not
 * there yet.
 */
export function compileCondition(src: string): ExprFn {
    const toks = lex(src);
    let p = 0;
    const peek = () => toks[p];
    const eat = (v?: string) => {
        const t = toks[p];
        if (!t || (v && t.v !== v)) throw new Error(v ? `expected "${v}"` : 'unexpected end');
        p++;
        return t;
    };

    const parseTerm = (): ExprFn => {
        const name = eat();
        if (name.t !== 'name' || !TERMS[name.v]) {
            throw new Error(`unknown check "${name.v}" — try ${EXPR_TERMS.join(', ')}`);
        }
        eat('(');
        const sel = eat();
        if (sel.t !== 'str') throw new Error(`${name.v}() needs a selector in quotes`);
        eat(')');
        const fn = TERMS[name.v];
        const op = peek();
        if (!op || op.t !== 'op' && !(op.t === 'kw' && op.v === 'contains')) {
            return () => !!fn(sel.v);
        }
        p++;
        const rhs = eat();
        if (rhs.t !== 'num' && rhs.t !== 'str') throw new Error(`"${op.v}" needs a number or a quoted string after it`);
        const want: string | number = rhs.t === 'num' ? Number(rhs.v) : rhs.v;
        return () => {
            const got = fn(sel.v);
            switch (op.v) {
                case 'contains': return String(got).toLowerCase().includes(String(want).toLowerCase());
                case '==': return typeof want === 'number' ? Number(got) === want : String(got) === want;
                case '!=': return typeof want === 'number' ? Number(got) !== want : String(got) !== want;
                case '>': return Number(got) > Number(want);
                case '>=': return Number(got) >= Number(want);
                case '<': return Number(got) < Number(want);
                case '<=': return Number(got) <= Number(want);
                default: return false;
            }
        };
    };

    const parseUnary = (): ExprFn => {
        const t = peek();
        if (t?.t === 'kw' && t.v === 'not') { p++; const inner = parseUnary(); return () => !inner(); }
        if (t?.t === 'punc' && t.v === '(') { p++; const inner = parseOr(); eat(')'); return inner; }
        return parseTerm();
    };
    const parseAnd = (): ExprFn => {
        let left = parseUnary();
        while (peek()?.t === 'kw' && peek().v === 'and') { p++; const r = parseUnary(); const l = left; left = () => l() && r(); }
        return left;
    };
    const parseOr = (): ExprFn => {
        let left = parseAnd();
        while (peek()?.t === 'kw' && peek().v === 'or') { p++; const r = parseAnd(); const l = left; left = () => l() || r(); }
        return left;
    };

    const root = parseOr();
    if (p < toks.length) throw new Error(`unexpected "${toks[p].v}" at the end`);
    // Evaluation is total: an element that is not there yet is "not yet".
    return () => { try { return !!root(); } catch { return false; } };
}

/** Compile without throwing — for the editor, which wants the message, not an exception. */
export function checkCondition(src: string): { ok: true } | { ok: false; error: string } {
    try { compileCondition(src); return { ok: true }; }
    catch (e) { return { ok: false, error: (e as Error).message }; }
}
