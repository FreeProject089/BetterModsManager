/**
 * bmms-prism.ts — BMMScript, as a Prism grammar.
 *
 * The scheduler's code box gets its colours from the same mirror every other code block in
 * BMM uses (ui/code-editor.ts, ui/code-highlight.ts, prism-bmm.css). Writing a second
 * highlighting mechanism for this one textarea would have meant a second answer to the
 * geometry problem code-editor.ts already solved and documented, a second debounce, a second
 * size ceiling, and a palette that does not follow the active theme. So the only new thing
 * here is the grammar.
 *
 * **The keyword list is generated.** `BMMS_KEYWORDS` is extracted from the Rust parser
 * itself (scripts/gen-bmms-reference.mjs reads `fn stmt`'s match arms and every
 * `at_word`/`eat_word`), so a statement added to the compiler is coloured on the next
 * regeneration, and `--check` in CI fails if somebody forgets. A hand-kept list would be
 * wrong the day the language grows a keyword — and wrong *silently*, since an unknown
 * keyword simply renders as a name.
 *
 * **A grammar is not a parser.** BMM has exactly one BMMScript compiler, in Rust, and the
 * whole language rests on there being only one. This decides colours: when it is wrong the
 * worst outcome is a word in the wrong colour, never a script that runs differently from how
 * it reads. It reports nothing and refuses nothing — the live compile beside the box does
 * both, from the real compiler.
 */

import { BMMS_KEYWORDS } from '../../docs/bmms-reference.gen.js';

let registered = false;

/**
 * Teach Prism about BMMScript. Idempotent, and a no-op when Prism is not loaded.
 *
 * Order matters in a Prism grammar — the first pattern to match a position wins — and two
 * of the orderings below are the whole reason the file is not three lines:
 *
 *   · `comment` before `string` would turn `"tag #1"` into a comment that swallows the rest
 *     of the line; `string` therefore comes first, and a `#` inside quotes stays text.
 *   · `parameter` before `keyword` so that `do x(if: 1)` colours `if` as the parameter name
 *     it is, rather than as the statement it is not.
 */
export function registerBmmsLanguage(): void {
    if (registered) return;
    const Prism = (globalThis as any).Prism;
    if (!Prism?.languages) return;
    registered = true;

    Prism.languages.bmms = {
        // Strings first — everything inside one is text, including `#` and `//`.
        string: {
            pattern: /"(?:\\.|[^"\\\r\n])*"?/,
            greedy: true,
            inside: {
                // The hole a value drops into. Colouring it is the single most useful thing
                // in this file: a mistyped `{item.nmae}` reads exactly like prose until it
                // runs, and picking it out of the sentence around it is what makes it
                // checkable at a glance.
                variable: /\{[^{}\r\n]*\}/,
            },
        },
        comment: {
            pattern: /(^|[^\\:])(?:#|\/\/).*/,
            lookbehind: true,
            greedy: true,
        },
        // A `name:` before a value is a parameter whatever the word is.
        property: /\b[A-Za-z_]\w*(?=\s*:)/,
        // The name after `do` or `call` is an action or another task, not a keyword — even
        // when it happens to be spelled like one.
        function: {
            pattern: /((?:^|[^\w.])(?:do|call)\s+)[A-Za-z_][\w.]*/i,
            lookbehind: true,
        },
        // `30s`, `1.5h`, `03:00`, plain numbers.
        number: /\b\d+(?:\.\d+)?(?:ms|s|m|h|d)?\b/,
        keyword: new RegExp(`\\b(?:${BMMS_KEYWORDS.join('|')})\\b`, 'i'),
        // Names that are neither: actions used bare, condition names, loop sources.
        'class-name': /\b[A-Za-z_]\w*(?:\.\w+)+\b/,
        operator: /[=!<>]=?|[+\-*/%]|\b(?:and|or|not)\b/i,
        punctuation: /[{}()[\],:]/,
    };

    // The scheduler prints tasks with the same grammar, so a `.bmmscript` shown anywhere
    // else in the app — the share preview, the docs — gets the same colours under either
    // name people write.
    Prism.languages.bmmscript = Prism.languages.bmms;
}
