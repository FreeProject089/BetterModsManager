# Every command, and when you want it


For contributors. Grouped by what you are trying to do rather than by which tool provides it,
because at the moment you need a command you know the goal, not the package.

Paths are relative to the repository root. Everything here comes from `package.json`,
`scripts/`, and the script headers themselves.

## The two you will use most

```bash
npm run dev        # TypeScript watch + the Tauri window, together
npm run ci         # every gate, in the order CI runs them
```

`npm run ci` is 43 steps. It is slow on purpose — it is the difference between "it compiles"
and "it works".

## Building

```bash
npm run compile         # TypeScript → frontend/js
npm run typecheck       # types only, emits nothing
npm run watch           # compile, and keep compiling
npm run build           # the full release chain (see below)
npm run release         # build, then the installer
npm run build:installer # the installer alone
npm run gen             # regenerate everything derived from the source
npm run gen-manifest    # the update manifest alone
npm run tauri           # the raw Tauri CLI, for anything not wrapped above
```

`npm run build` runs, in order: dev-toggle check → security guard → **gen** → doc sync →
encoding check → `tsc` → import check → `tauri build --no-bundle` → update manifest.

### What `gen` produces

Three generators, and the order between them matters:

| Written | From | Why it is generated |
|---|---|---|
| `frontend/src/docs/bmms-reference.gen.ts` and both `bmmscript-reference` pages | the scheduler's own registries | a hand-written reference is the one part of BMMScript that can go stale, and it would keep promising 75 actions while the app grew to 90 |
| `dist-assets/bmms-vocabulary.json` | the same registries, plus the Rust parser's keywords | BCWEB's `.bmmscript` checker reads it instead of keeping a second list of action names — which would be wrong the day somebody adds one |
| `src-tauri/src/mcp/actions.gen.json` | the action registry | so an assistant offers exactly the actions that exist |
| `frontend/deeplinks.json` | `deep_link_manager.ts` | so a builder offers exactly the links the router handles |

`gen-bmms-reference` writes both a `.ts` the compiler reads **and** two pages `sync-docs` copies
into the app, so it has to run before either. That is why `gen` sits where it does in the chain
rather than at the end.

!!! note "CI checks them; the build writes them"

    Every one of these has a `--check` mode that runs in `npm run ci` and fails when the
    committed file no longer matches the source. That catches a stale commit before it is
    merged.

    `npm run build` regenerates instead, so a release never ships an artifact that disagrees
    with the code it came from. Both halves are needed: the check keeps git honest, the build
    keeps the release honest.

!!! warning "The vocabulary still has to be uploaded"

    `dist-assets/bmms-vocabulary.json` is not bundled with the app and is not published
    anywhere by building. BCWEB reads it as a platform asset that somebody uploads, and nothing
    on that side can tell that its copy is six months old — the symptom is a checker calling
    valid action names unknown. Re-upload it after the language grows.

!!! warning "The compiled JavaScript is committed"
    `frontend/js/**` is tracked, so the committed JS must be what the committed TypeScript
    compiles to. `check-compiled-fresh` enforces it, and it wants the file **committed**, not
    merely staged:

    ```bash
    npm run compile && git add frontend/js/<the file> && git commit
    ```

## Checks, by what they protect

Run them all with `npm run ci`. Individually, when you know what you touched:

### Text and translation

```bash
npm run check:i18n        # EN/FR parity — both files, same keys
npm run check:i18n-keys   # every literal t() key resolves
npm run check:text        # prose that never reaches t()
npm run check:encoding    # mojibake and stray escapes
npm run check:markup      # HTML that md-lite would mangle
npm run test:i18n         # the Python parity test
```

### Appearance

```bash
npm run check:colors      # hardcoded colours instead of tokens
npm run check:neutrals    # inline greys that ignore the theme
npm run check:tokens      # two tokens resolving to the same thing
npm run check:css         # selectors that match nothing
npm run check:css-vars    # variables used but never defined
npm run check:kit         # components built by hand instead of from ui/kit
```

### Correctness

```bash
npm run check:imports     # import paths that do not resolve
npm run check:boot        # what the first paint has to download
npm run check:dev-toggles # a debug switch left on
npm run security-guard    # CWE-95 / CWE-749 regressions
npm test                  # the Node test suite
```

### Features with their own invariants

```bash
npm run check:sched-vars    # scheduler variables
npm run check:tutorial      # the tutorial's steps still point at real things
npm run check:diagrams      # diagram registry vs what pages claim
npm run check:catalog-docs  # catalogue docs vs the reader
npm run check:installer     # installer config
npm run check:resources     # every file the Rust asks for is actually in the bundle
npm run check:nesting       # index.html closes its tags; no modal inside another modal
npm run check:links         # external links
npm run check:docs          # documentation cross-references
```

## Understanding the codebase

These print reports. They change nothing.

```bash
npm run map:deps        # module graph: hubs, orphans, cycles
npm run map:api         # frontend → Rust calls, and what has no caller
npm run map:deeplinks   # every bmm:// action and the parameters it reads
npm run map:deeplinks:json  # ...and WRITE frontend/deeplinks.json (what BCWEB publishes)
npm run impact          # which tests cover your current change — and what nothing covers
```

`npm run impact` is the one worth knowing about before a big change: it answers "if I break
this, what tells me".

## Documentation

```bash
npm run sync-docs           # copy BMM Docs into the app
npm run sync-docs -- --check # fail if the copy is stale (CI does this)
npm run check:docs          # cross-references resolve
```

One source, two renderers: mkdocs builds the site and BMM renders the same markdown through
md-lite. A page therefore cannot say two different things in two places — but the copy must be
regenerated and committed when the source changes.

## Rust

From `src-tauri/`:

```bash
cargo check           # fast: does it compile
cargo clippy -- -D warnings
cargo fmt --check
cargo test
```

## Recording documentation media

```bash
node scripts/record-take.mjs     # puts BMM in a known state, arms the recorder, exports a .bmmreplay
cd "BMM Docs" && python tools/check_media.py   # which media are still placeholders
```

The shooting list — every clip and screenshot still to make, with its settings — is
`.Assets/MEDIA_TO_RECORD.md`.

## Traps

Each of these has cost real time here.

- **`$?` after a pipe is `tail`'s status**, almost always 0. Use `${PIPESTATUS[0]}`.
- **A green `tsc` is not a working app.** Files marked `@ts-nocheck` are invisible to it;
  `check-undefined-names` exists because of one.
- **`export { X } from '…'` does not bind `X` locally.** The module re-exports it and cannot
  call it.
- **Heredocs eat escapes.** `\n` in a bash heredoc becomes a real newline and `\b` becomes
  `0x08` — a regex that then matches nothing and stays green. Write the script to a file
  instead.
