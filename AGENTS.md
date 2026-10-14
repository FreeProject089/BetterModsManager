# AGENTS.md

A short guide for AI coding agents working in the Better Mod Manager (BMM) repository. Humans
should read [CONTRIBUTING.md](CONTRIBUTING.md) first; the rules are the same.

Where things live: [REPO_MAP.md](REPO_MAP.md). Security policy: [SECURITY.md](SECURITY.md).
How a release works: [RELEASE.md](RELEASE.md).

## Stack

- Tauri v2 desktop app for Windows. Rust core in `src-tauri/`, TypeScript UI in `frontend/src/`
  compiled to `frontend/js/`.
- `BMM Docs/`, `BetterInstaller/` and `BCW/` are separate git repositories (submodules). Do not
  change them from a BMM task unless asked.

## Commands

```bash
npm install
npx tsc --project frontend         # compile the UI (also: npm run compile, npm run watch)
npm test                           # Node unit tests: tests/*.test.mjs
npm run ci                         # the full gate chain, in the order CI runs it
cd src-tauri && cargo check --all-targets && cargo test
npm run dev                        # run the app (tsc watch + tauri dev)
npm run build                      # gates + compile + tauri build --no-bundle
```

Run `npm run ci` before you report a change as done. Each gate prints why it failed and what to do.
`check-compiled-fresh` fails while compiled `frontend/js` changes are not committed yet; that one is
expected on a dirty tree.

## Gates

- Gates are `scripts/check-*.mjs`, chained in the `ci` script of `package.json`.
- A red gate is information, not an obstacle. Fix the cause; do not weaken a gate, raise a baseline or
  add an allowlist entry to make it pass. Baselines (`scripts/*baseline*.json`) only go down.
- To add a gate, see CONTRIBUTING.md.

## Translations (i18n)

- Every user-visible string goes through `t('key', 'fallback')` or a `data-i18n` attribute. No
  hard-coded UI text (`check-hardcoded-text`).
- A new key goes into `frontend/Lang/en.json`, `frontend/Lang/fr.json` (parity is checked) and
  `frontend/Lang/template.json`.
- Insert keys textually, next to their neighbours. Never load and re-serialise the JSON files: that
  reorders keys, rewrites escapes and turns a one-line change into a diff of the whole file.
- Error strings returned by Rust commands that are translation keys must exist in both languages
  (`check-i18n-rust`).
- French text follows the typography already used in `fr.json` (« guillemets », accents).

## Markdown

All markdown is rendered with B.MD (`frontend/src/docs/md-lite.ts`, `md-safe.ts`). Text from
outside (repos, catalogues, the model, imports) goes through the safe path. Do not add another
markdown renderer.

## Rust rules

- Spawn processes only through `crate::commands::proc` (no console window flash). Never call
  `std::process::Command::new` / `tokio::process::Command::new` directly.
- Heavy work (copy loops, hashing, thread pools) goes through the resource governor
  (`src-tauri/src/governor/`). `check-governed` counts ungoverned sites against
  `scripts/governed-allowlist.json`; a new one needs routing or a listed reason.
- A new Tauri command must be registered in `generate_handler!` in `src-tauri/src/main.rs`
  (`check-invoke-names`).
- A new API route needs a permission check and an entry in the API reference (`check-api-*`).

## Files and encoding

- All text files are UTF-8 without BOM.
- Never rewrite files with PowerShell `Get-Content` / `Set-Content` / `Out-File`: Windows PowerShell 5.1
  reads UTF-8 as Windows-1252 and writes a BOM, which mangles every accent (`check-encoding` catches
  the result). Use the edit tools, Node, or `[IO.File]` with `UTF8Encoding($false)`.
- Do not hand-edit generated files. Run the generator:
  - `frontend/js/**` (except `js/lib/`): `tsc --project frontend`
  - `frontend/assets/docs/**`: `node scripts/sync-docs.mjs` (edit the source in `BMM Docs/docs`)
  - `src-tauri/src/commands/ask_index.gen.json`: `node scripts/gen-ask-index.mjs`
  - `src-tauri/src/mcp/actions.gen.json`: `node scripts/gen-mcp-actions.mjs`
  - `frontend/src/docs/bmms-reference.gen.ts`, `dist-assets/bmms-vocabulary.json`: `node scripts/gen-bmms-reference.mjs`
  - `frontend/assets/credits-*.gen.json`: `node scripts/gen-credits.mjs`
  - `frontend/deeplinks.json`: `node scripts/deeplink-map.mjs --json`
  - `npm run gen` runs the last four together. The full list is in REPO_MAP.md.

## Shared working tree

Several agents and the owner may work in this checkout at the same time.

- Never run `git stash`, `git reset`, `git checkout -- <path>`, `git restore`, `git clean`, or switch
  branches. They act on everyone's uncommitted work.
- Do not commit unless asked. When asked, stage by path, only your files, and check the staged diff.
- Commit messages: one descriptive line in the style of `git log`. No AI attribution or
  `Co-Authored-By` lines.
- Do not remove `.claude/worktrees/*` or prune worktrees.

## Security

- Never commit secrets: tokens, keys, `.env*`, `*.key`, `keys/`. CI runs gitleaks. Fake secrets in
  tests must not look like real provider tokens (GitHub push protection blocks them).
- Do not weaken update verification: signed `update-manifest.json` (Ed25519, expiry), the
  BetterInstaller signature check, SHA-256 checks of downloads. A failure must fail closed.
- Do not weaken signed repos and catalogues (key pinning, `keyauth`), path confinement of archive
  extraction and file writes, the local API token and per-plugin permissions, or the CSP.
- Every privacy or terms consent leaves a versioned, hashed receipt (`commands/consent_ledger.rs`).
  A new consent surface must record one. Telemetry stays off until the user agrees.
- When a feature changes what data leaves the machine, update `PRIVACY.md` / `PRIVACY_FR.md` and
  `ENDPOINTS.md`.

## Where to look first

- Area of the UI: `frontend/src/features/<area>/`, markup in `frontend/index.html`.
- Backend for it: `src-tauri/src/commands/<area>*.rs`.
- Why a gate exists: the comment block at the top of `scripts/check-<name>.mjs`.
- Behaviour and formats: `BMM Docs/docs/` and `Update/Documentation/`.
- What changed recently: `Update/changelog_v1.0.2_EN.md` and `git log`.
