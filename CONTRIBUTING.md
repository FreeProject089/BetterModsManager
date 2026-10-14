# Contributing to Better Mod Manager

English · [Français](CONTRIBUTING_FR.md)

Thanks for helping. This guide covers setup, the commands, the rules a change must follow and how
to send it. Where things live: [REPO_MAP.md](REPO_MAP.md). Notes for AI coding agents:
[AGENTS.md](AGENTS.md). Security issues: [SECURITY.md](SECURITY.md), never a public issue.

## Setup

You need:

- **Windows 10 or 11** (BMM is a Windows app).
- **Node.js 22**, the version CI uses.
- **Rust stable** (`rustup default stable`).
- The **[Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)**: Microsoft C++ Build
  Tools and **WebView2** (already present on up-to-date Windows 10 and 11).
- Optional: the `BMM Docs` and `BetterInstaller` submodules, for the docs sync and the installer.

```bash
git clone https://github.com/FreeProject089/BetterModsManager.git
cd BetterModsManager
git submodule update --init "BMM Docs" BetterInstaller   # optional
npm install
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | TypeScript watch and the app in development mode. |
| `npm run build` | Pre-build gates, generators, docs sync, compile, `tauri build --no-bundle`, update manifest. |
| `npm run build:installer` | Builds the installer with BetterInstaller (`BetterInstaller/examples/bmm/`). |
| `npm test` | Node unit tests (`tests/*.test.mjs`). |
| `npm run ci` | Every gate, in the order CI runs them (includes `tsc` and `npm test`). |
| `cargo check --all-targets`, `cargo test` | Rust checks, run in `src-tauri/`. |
| `npm run gen` | Regenerates the generated references (BMMScript, MCP actions, deep links, credits). |

The release process is described in [RELEASE.md](RELEASE.md).

## Branches and commits

- Development happens on **`Tdev`**; `main` is what releases are cut from, and a release is a `v*` tag.
  Open pull requests against `Tdev`.
- One change per commit. The message is **one descriptive line** saying what changed and why, in the
  style of `git log` (for example: *"Update dialog: the reason an installer could not be checked is
  shown in the reader's language"*).
- No AI attribution or `Co-Authored-By` lines in commit messages.
- Never commit secrets, `.env*` files, keys or anything under `Release/`.

## Rules a change must follow

- **`npm run ci` passes.** Each gate explains its failure. Fix the cause rather than loosening the
  gate; baselines only go down.
- **Translations**: every visible string uses a translation key. Add each key to
  `frontend/Lang/en.json`, `fr.json` and `template.json`, inserted next to its neighbours (do not
  re-serialise the files). See `Update/Documentation/TranslationGuide_EN.md`.
- **Docs**: a user-visible change updates its page in `BMM Docs/docs` (EN `page.md` and FR
  `page.fr.md`), then `node scripts/sync-docs.mjs`. Markdown is rendered with B.MD; do not add another renderer.
- **Changelog**: user-visible changes go in `Update/changelog_v<version>_EN.md` and `_FR.md`.
- **Generated files** are never edited by hand; run their generator (list in REPO_MAP.md).
- **Encoding**: UTF-8 without BOM. Do not rewrite files with PowerShell `Get-Content`/`Set-Content`.
- **Rust**: spawn processes through `crate::commands::proc`, route heavy work through the resource
  governor, register new commands in `src-tauri/src/main.rs`.
- **Privacy**: a change to what leaves the machine updates `PRIVACY.md`/`PRIVACY_FR.md` and
  `ENDPOINTS.md`; a new consent surface records a consent receipt.

## Tests

- Logic in TypeScript gets a test in `tests/<name>.test.mjs` (Node's built-in test runner).
- Rust logic gets unit tests in its module or a `*_tests.rs` file next to it; fixtures go in
  `src-tauri/tests/`.
- A bug fix comes with a test that fails without the fix when that is practical.

## Adding a CI gate

1. Write `scripts/check-<name>.mjs`. Start it with a comment that says what it catches and why it
   exists, and exit `1` with a message that tells the reader how to fix the failure.
2. Add `node scripts/check-<name>.mjs` to the `ci` script in `package.json` (CI runs `npm run ci`).
   A shortcut such as `"check:<name>"` is welcome.
3. If the gate has non-trivial parsing, test it in `tests/` (see `tests/check-governed.test.mjs`).
4. Make sure it passes on the current tree and fails on the case it is meant to catch.

## Code of conduct

There is no separate code of conduct file. Be respectful and constructive in issues, pull requests
and on [Discord](https://discord.gg/CTaaEF9R75).

## License

By contributing you agree that your contribution is licensed under the
[GNU General Public License v3.0 or later](LICENSE.md).
