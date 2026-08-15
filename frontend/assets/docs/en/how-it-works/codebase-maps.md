# Codebase maps

Three tools that answer questions the compiler cannot. They read the source and print a
structure; none of them ships in the app, and none of them needs the app running.

They exist because BMM has two boundaries with no type checking behind them, and a test
suite far smaller than the codebase — so "did I break anything" had no cheap answer.

---

## The module graph — `npm run map:deps`

Reads every `import` in `frontend/src` and answers three things `tsc` does not, because a
compiler is happy with any graph that resolves.

| Question | Why it is not obvious |
|---|---|
| Which module is the **hub**? | `core/i18n.ts` is imported by 66 others. A change there is never small, and nothing says so. |
| Which modules are **unreachable**? | `tsc` compiles them and the bundle carries them. `docs/docs-ui.ts` sat dead for months. |
| Which imports form a **cycle**? | ES modules tolerate cycles until one reads a binding at evaluation time — then it is `undefined` at runtime, with a stack pointing at the wrong file. |

```bash
npm run map:deps
```

`--tree <module>` draws what importing one module actually pulls in, with cycles marked and
repeats collapsed — the same renderer the mod dependency tree uses:

```
docs/docs-hub.ts
 ├── core/i18n.ts
 │    ├── types/models.ts
 │    └── core/api.ts
 │         ├── features/debug/debug.ts
 │         │    ├── core/api.ts  [cycle]
```

### The gate

`node scripts/dep-graph.mjs --check` runs in `npm run ci`. It is a **ratchet against a
committed baseline**, not a demand for zero: this codebase has 77 cycles and 7 unreachable
modules today, and a gate insisting on zero on day one is a gate somebody switches off in
week two. It fails when a number *grows*, and says so when it shrinks.

Lower it deliberately with `--check --update`, which rewrites `scripts/dep-graph.baseline.json`.

---

## The API surface — `npm run map:api`

`invoke` is non-generic and returns `Promise<any>`, so TypeScript checks **nothing** about a
call to the Rust core: not the name, not the arguments, not whether the command still exists.
A typo compiles perfectly and fails at runtime as a rejected promise.

`check-invoke-names.mjs` already gates one direction — every `invoke()` name must reach a
registered command. This is the rest of the shape:

- **368** commands registered, **324** called from the frontend, **63** modules calling at
  least one. `features/settings/scheduler.ts` alone touches 54.
- Per Rust module, how much of it the UI actually uses.
- **44 commands with no frontend caller.** Reported as exactly that and *never* as "unused":
  the MCP server, the CLI and `bmm://` deeplinks all reach commands the UI never touches.
  This tool cannot tell an MCP-only command from a forgotten one and does not pretend to.
- **Dynamic invokes** — `invoke(name)` rather than `invoke('name')`. There are 3, and the
  count is the honest measure of how much of the surface is being checked at all.

---

---

## Every `bmm://` action — `npm run map:deeplinks`

The link builder on BetterCommunity offered four deeplink actions, hand-typed, in a different
repository. BMM handles **43**.

Two problems in that arrangement, and the second is the one that lasts. A builder offering an
action the app does not handle produces a link that opens BMM and does nothing — worse than no
builder, because it looks like the app is broken. And a list copied into another repo is wrong
the first time somebody adds a deeplink here, silently.

So the table is derived from `deep_link_manager.ts` and committed as `frontend/deeplinks.json`:
every action with the parameters it actually reads, including the ones nobody would guess —
`repo/sync` takes seven, `app/install` takes five, eight take none at all.

`node scripts/deeplink-map.mjs --check` runs in `npm run ci`, so adding a deeplink and
forgetting the table is a build failure rather than a wrong link discovered later. The parser
also refuses to emit fewer than 15 actions: one that silently matched nothing would produce an
empty table, and an empty table reads as "BMM has no deeplinks".

!!! note "The figures on this page are a snapshot"
    They were true when it was written and each tool prints its own. `npm run map:deps`,
    `map:api`, `map:deeplinks` and `impact` answer for today; this page explains what the
    numbers mean.

## What a change actually touches — `npm run impact`

```bash
npm run impact               # uncommitted work
npm run impact -- --since main
npm run impact -- --run      # run exactly the selected tests
```

Two lists. The first — which tests reach your change — is a convenience. The second is the
one worth reading: **which changed files no test reaches**.

There are 16 test files for 150 modules, so for most changes the honest answer is "no test
would tell you either way", and the only previous way to know which part was tracing it by
hand. Coverage follows the dependency graph, so a test importing `rich-markdown.ts` counts
as reaching `core/i18n.ts` two hops below it.

!!! warning "Which way it errs"
    Coverage here is **structural reachability**, not knowledge of what a test asserts.
    Importing a module does not mean exercising everything it imports. So this
    **over-reports coverage and under-reports gaps** — which means a file it lists as
    uncovered genuinely is one. `ui/app.ts` and `features/mods/mods.ts`, the two largest
    modules in the codebase, are reached by no test at all.

Changed paths outside the module graph — Rust, CSS, HTML, docs, which is most of what
changes here — are listed separately. Counting them as uncovered would bury the real gaps;
omitting them would let a short list read as "your change is covered".
