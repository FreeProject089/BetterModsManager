# Release tool

[Français](README_FR.md)

One command that builds and checks everything a BMM release needs, step by step, with a log per
step and a summary at the end. It never commits, tags, pushes or publishes: the last step prints
the `gh release create` command and a person runs it.

```bat
tools\release\release.bat
```

Without arguments it shows a menu: pick the version, then the steps (`a` for all, `1,3,5-7`, `q`
to quit). For a run with no questions:

```bat
tools\release\release.bat --all --version 1.0.4 --yes
tools\release\release.bat --version 1.0.4 --steps preflight,changelog,verify,media --yes
```

Everything lands in `Release/<version>/` (gitignored), logs in `Release/<version>/logs/`.
A failed step stops the run, unless you answer « continue » (interactive) or pass `--continue`.
The summary always runs.

## The steps

| # | Step | What it does | Produces |
|---|---|---|---|
| 1 | `preflight` | git branch and state (a dirty tree is a warning), previous version and the commit its history ends at, toolchain versions (node, npm, rustc, cargo, Tauri CLI, bpkg, gh, python, hyperfine, ffmpeg, Gource, Chrome), `check-release-versions`, curated changelog present, machine busy or not. `--gates` runs `npm run ci`, `--tests` runs `npm test`, `--cargo-test` runs `cargo test` (asked interactively) | log |
| 2 | `version` | shows the version of every source (package.json, package-lock.json, tauri.conf.json, Cargo.toml, Cargo.lock, BetterInstaller installer.toml), asks the new one (`x.y.z`, `patch`, `minor`, `major`, `pre`), rewrites only the version bytes (UTF-8 without BOM; refuses a rewrite that would change any accent or the line count), runs `check-release-versions` | the 6 files |
| 3 | `changelog` | `git log <previous>..HEAD` grouped into security / features / fixes / docs / CI / chore / other (Conventional prefixes win, else keywords), with hashes, dates and author **names** (never e-mails); plus the log of each gitlink (BMM Docs, BetterInstaller, BCW) between the commit recorded at the previous version and now. Warns when `Update/changelog_v<version>_{EN,FR}.md` (human-written) is missing | `COMMITS.md` |
| 4 | `gource` | runs BEFORE the build, so the installer ships the new credits video. History video of BMM + BMM Docs + BetterInstaller + BCW (+ `../BetterCommunity-v2` when present), one merged log, **no captions and no version text**: readable file names, the BMM logo (`frontend/assets/brand/bmm-wordmark-dark.svg` drawn to PNG, `--logo`), dark background; MP4 (H.264, yuv420p, +faststart), a light GIF and a poster; re-encodes `frontend/assets/videos/credits_bg.mp4` from it (muted, fades for a clean loop, never larger than before). The build warns when the credits video is older than the latest commit | `media/gource-<v>.mp4`, `.gif`, `-poster.png`, credits video |
| 5 | `build` | waits for an idle machine, runs `BetterInstaller/examples/bmm/release.ps1 -Version <v>` (no `-Publish`): bump check, `npm run build`, package, sign, stamp `BMM-Setup.exe`, delta, signed `update.json`, signed `update-manifest.json`. Then `npx tauri build --bundles nsis,msi` for the classic installers | `BMM-Setup.exe`, `bmm.bpkg`, `update.json`, `update-manifest.json`, `lang-*.json`, `links.json`, `extras/` (NSIS + MSI, **not for GitHub**) |
| 6 | `verify` | `bpkg info` (version), `bpkg verify --key` (signature), `bpkg verify-manifest --setup` (setup ↔ manifest), update.json lists `BMM-Setup.exe` with the right SHA-256, update-manifest.json lists exactly that installer, expiry dates printed (warns under 6 days), the 0.9.11 asset rules (one installer named `BMM-Setup.exe`, no .msi, no .zip), `check-release-versions --artifacts` (when `Release/` root still holds this build), checksums | `SHA256SUMS.txt` |
| 7 | `docs` | BMM Docs English and French PDFs without WeasyPrint/GTK: a private venv (`tools/release/.cache/docs-venv`) with the docs' hashed `requirements.txt` (it pins the print-site plugin and pypdf already: a plain install, no `--no-deps`), one single-language site per language built by BMM Docs' OWN `language_config` (`docs/lang_config.py` calls it; no local copy any more), then headless Chrome dresses each `print_page/` as a book (`docs/print-style.mjs`): cover (logo, title, version, date), table of contents with page links and page numbers (read from the bookmarks of a first print), dark text on white at WCAG AA (measured), readable code, bordered tables, GIFs replaced by one still frame, replays replaced by a link, running header (BMM name, version) and footer (page x / y), PDF bookmarks | `docs/BMM-Docs-EN.pdf`, `docs/BMM-Docs-FR.pdf` |
| 8 | `media` | compiles the frontend first (`npx tsc --project frontend`) and **fails** when a compiled file is older than its source or the sources do not say the version being released (the pictures show the app as it is now, served from `frontend/`: the same files Tauri bundles, so no build is needed; `--no-compile` skips tsc); release cards from `tools/release/media/cards.mjs` (text from `cards.<version>.json`), screenshots of the real interface with demo data, **composed like BMM on a desktop**: the whole rounded window on a transparent canvas and Tasky floating over its top-left corner (`--no-tasky` to leave him out), the README hero; each visual also as an editable layered SVG and a layered PSD | `media/*-tasky.png` and `*-plain.png` (`.fr` too), `media/source/{svg,psd}/` + `README.md`, `media/screenshots/…` (with `hero.png`, `hero@2x.png`, `hero.mp4/.webm/.gif`, `hero-flat.png`), `.github/screenshots/*.png`, `.github/screenshots/layers/`, `.github/screenshots/source/*.svg` |
| 9 | `readme` | README.md / README_EN.md / README_FR.md: version badge, hero alt text, « What's new in X » and the changelog links (links only move when the new changelog exists; « new in 1.0.2 » next to a feature is history and stays) | the 3 READMEs |
| 10 | `bench` | waits for an idle machine, runs Criterion, the memory collector, the JS micro-benchmarks and hyperfine, stores `benchmarks/results/<version>/summary.json` (committed) + `raw/` (ignored), compares with the newest earlier version, writes the report | `bench/BENCHMARK.md`, `BENCHMARK_FR.md`, `BENCHMARK.html`, `comparison.json`, `charts/*.png|svg`, `charts/overview.gif` |
| 11 | `notes` | `github-release.md`: the maintainer-notes comment (title, tag, order, assets, signing, verify), the curated changelog as the body, downloads table, SHA-256 table, links; `github-release.body.md` without the comment, for `--notes-file`. Prints the `gh release create` command. A hand-edited `github-release.md` is never overwritten (the draft goes to `github-release.generated.md`) | the two files |
| 12 | summary | always: table of steps, durations, outputs; refreshes `SHA256SUMS.txt` | `RELEASE-SUMMARY.md` |

**Only `BMM-Setup.exe` is published as the installer.** BMM 0.9.11 runs the first `.msi`/`.exe`
of a release (see [RELEASE.md](../../RELEASE.md), « Bridging older installs »), so the classic
NSIS/MSI builds stay in `extras/` and never go on GitHub.

## Options

Run `release.bat --help` for the list. The useful ones:

| Option | Effect |
|---|---|
| `--version X.Y.Z` | the version (else package.json, or asked) |
| `--all` / `--steps a,b` | which steps (ids or numbers) |
| `--yes` | no questions; stop at the first failure |
| `--continue` | keep going after a failure |
| `--from <ref>` / `--previous X.Y.Z` | override the detected start of the history |
| `--gates`, `--tests`, `--cargo-test` | the heavy gates in preflight |
| `--skip-bmm-build` | build: reuse the built exe (`release.ps1 -SkipBmmBuild`) |
| `--no-bundles` | build: no NSIS/MSI extras |
| `--lenient-artifacts` | verify: `check-release-versions --artifacts` failing is a warning |
| `--no-compile`, `--no-screenshots`, `--no-loop`, `--no-tasky`, `--tasky app|br|off`, `--gifs` | media options (`--gifs`: also record the usage clips) |
| `--bench-skip-run`, `--bench-only rust,js,hyperfine,mem` | benchmark options |
| `--gource-seconds N`, `--no-credits` | Gource options (the step sits before `build`; `--steps` always runs in step order) |
| `--no-wait`, `--force` | do not wait for an idle machine; run anyway |
| `--max-cpu N`, `--wait-minutes N` | bench: « idle » also means other programs use at most N % CPU (default 10: a game or a video call counts as busy); how long to wait |

## How the previous version is found

1. `--from <ref>` when given;
2. the curated changelog's first line, « Changelog v1.0.2 (since 60b5f6d, …) »;
3. a `v<previous>` tag, **only** if it is an ancestor of HEAD and its package.json says that
   version (in this repository the v1.0.1 / v1.0.2 tags point at a main commit that says 0.9.9);
4. the GitHub release of the previous version (read with `gh release list`): the last commit
   before it was published;
5. the last commit whose package.json still said the previous version.

The previous version itself is the highest version below this one among tags and GitHub releases.

## Benchmarks

`benchmarks/results/<version>/summary.json` holds every metric of a version: point estimate,
95 % interval, sample count, throughput, machine and toolchain. The release before is the newest
`results/<lower version>/` on disk, or in git history. A verdict is **better** or **worse** only
when the change is beyond ±5 % (±15 % for one-shot numbers) **and** the two intervals do not overlap
(and Criterion's own change interval, when it compared with that version, does not include zero);
otherwise **same**. `BENCHMARK.md` explains every benchmark in plain words: what it measures, why a
user cares, unit, direction.

`benchmarks/results/1.0.0/summary.json` was captured from the results already on disk before the
1.0.2 run (Criterion June 2026, JS July, memory July, creator key September; package.json said
1.0.0 for all of them). There are no 1.0.1 results.

The benchmark code gained three 1.0.2 hot paths: `catalog_normalize` (the universal catalogue
normaliser, `catalog_format.rs` mounted verbatim), `repo_hash` (the Server Repo validate/convert
hasher, `repo_format.rs` mounted verbatim; sequential, parallel, cache hit) and, in the JS suite,
the activity registry and the frontend catalogue normaliser (the compiled modules themselves).

Only from the report (no new run): `node tools/release/bench/run.mjs --version 1.0.4 --skip-run`.

## Media

- Release cards (`media/cards.mjs`): social 1200×630, Discord 960×540, blog header 1600×600,
  square 1080, « what's new » 1200×675, each in English and French and in **two variants**:
  `…-tasky` (Tasky peeking over the top edge of the product shot, or sitting on a tile, inside the
  platform's safe zone) and `…-plain` (wordmark and badge only), so 20 PNGs named
  `bmm-<v>-<format>-<variant>[.fr].png`. Each is composed for its ratio: the wordmark lockup and a
  `v<version>` badge in Bricolage Grotesque, the headline, a subline, up to three highlights, and a
  real product shot (a screenshot of the release tilted in perspective by `media/stage.mjs` with a
  shadow and a glow) over the navy background with a **distorted grid** (a mesh bent by a lens
  around the product shot, a wave field and a perspective pull, drawn from a fixed seed, so every
  run draws the same one) and grain. Every text sits inside `cardSpecs().safe` (X/Mastodon 1.91:1
  crop, Discord corners, Instagram's 3:4 grid, link previews of the blog header) and is AAA (7:1)
  over what is under it (`cardContrast()`, tested). Text is wrapped and fitted with measured font
  widths (`media/metrics.mjs`).
- Card text per release: `tools/release/media/cards.<version>.json`: `en` / `fr` each with
  `headline` (6 words at most), `subline` (12 at most), `whatsNew` with `{version}`, three
  `highlights` (`icon` from Lucide, `title` of 5 words at most, `shot` + `crop` for the « what's new »
  tile), and `shots` (the screenshot each format shows). The step warns when a text breaks a limit
  or does not fit its box. Older files (`sub`, `chips`, `features`) still read. Without one the cards
  say generic things and the step warns. The version on every card comes from the run.
- README hero (`screenshots/hero3d.mjs`), 1600×800: three real windows (Library, Theme editor,
  Automations in Flow mode) floating in perspective with depth shadows, a brand glow and a floor
  reflection, Tasky peeking over the front window, the wordmark, tagline and version on the left.
  `hero.png`, `hero@2x.png`, and a 6 s loop where each window floats on its own sine (parallax):
  `hero.mp4` (H.264), `hero.webm` (VP9), `hero.gif` (800 px, 15 fps); `--no-loop` skips it. The
  flat banner of earlier releases is kept as `hero-flat.png` (`screenshots/hero.mjs`). Alone:
  `node tools/release/screenshots/hero3d.mjs --version <v> --shots <screenshots dir> [--no-loop]`.
- Screenshots: `tools/release/screenshots/` (`shoot.mjs`, `scenes.mjs`, `fixtures.mjs`). Scenes:
  library, profiles, repo-sync, repo-host, settings (Scanning), intro, apps, activity, tools, and
  since 1.0.4 mod-details, notifications, conflicts, automations-flow, laya, translation-studio,
  theme-editor, modpacks, modpack-wizard, history, catalogue-builder, settings-interface
  (`library-light` was removed). WebGL names a demo graphics card, so no real hardware shows.
  The tool serves `frontend/` itself on a random local port; with no Tauri runtime the app uses its
  built-in mock, fed with **demo data only** (`fixtures.mjs`: example.org addresses, a « Demo »
  user). Add a scene in `scenes.mjs`. Theme previews (THEMES.md): `node tools/release/screenshots/themes.mjs --frontend <checkout>/frontend --out <checkout>/.github/themes`, one Library picture per built-in theme of that checkout, same composition.
- Usage clips (GIF + MP4): `tools/release/screenshots/gifs.mjs`, scenes in `gif-scenes.mjs`
  (follow a repo, resolve a conflict, activity centre, theme editor, create a plugin, BMM Tools,
  notifications, settings). Same preview, demo data and composition as the screenshots, with a
  drawn pointer. The DevTools screencast records every repaint; ffmpeg (`C:\ffmpeg\bin`, or
  `FFMPEG`) holds each frame for its real duration and makes an MP4 (native size, 30 fps) and a
  palette-optimised GIF (1000 px, 14 fps, made smaller until it is under 8 MB). A scene can answer
  mock commands itself (`mock`) when the fixtures cannot show the flow, and play faster
  (`speed`). Alone: `node tools/release/screenshots/gifs.mjs [--previews] [--width 1000] [--fps 14] [--max-mb 8] [scene …]`;
  with the media step: `--gifs`. Output: `Release/<version>/media/gifs/` (`<name>.gif`, `.mp4`,
  `gifs.json`, `previews/`) for review; copy the validated ones to `.github/gifs/` by hand.
- Editable sources, all in `Release/<version>/media/source/` with a `README.md` (EN/FR) listing
  every file and its layers:
  - `svg/`: **layered SVG** (Inkscape layers in groups; Illustrator and Affinity read the ids as
    layer names): cards `Background (Field and glow, Grid) / Product shot / Tasky / Brand (Wordmark,
    Badge) / Text (Headline, Subline, Highlights, Footer)`, « what's new » adds `Screenshots`, heroes
    `Background / Windows / Tasky / Brand / Text`, screenshots `screenshot-<name>.svg` (window, Tasky,
    linked from `../../screenshots/layers/`). Text stays text; the fonts are named in each file.
  - `psd/`: **layered PSD** for every picture (cards × variants × languages, `hero.psd`,
    `hero-flat.psd`, `screenshot-<name>.psd`): Photoshop format 1, RGB 8-bit, RLE, the same groups
    as folders, the **sRGB** profile embedded (`lib/icc.mjs`), written by the dependency-free
    `lib/psd.mjs`. Text layers are pixels; each card's `.txt` next to its PSD gives their words.
  - After writing, the step **reads every PSD back** (`readPsd`: size, layers, groups, profile)
    and compares its flattened image with the PNG; a PSD that does not read or does not match
    fails the step (`media/sources.mjs`).
  - In the repository, `.github/screenshots/source/` keeps light SVGs that **link** the PNGs in
    `../` and `../layers/`; the self-contained SVG + PSD sources are in `Release/<version>/media/`.

## Gource

Needs Gource (`C:\Program Files\Gource`, or `GOURCE`) and ffmpeg (`C:\ffmpeg\bin`, or `FFMPEG`).
The custom log Gource writes has author names only; nothing leaves the machine. Avatars are local
pictures matched by name (`frontend/assets/userpfp/<name>.png`, the pictures `contributors.json`
names). Gource opens a window while it renders. `node tools/release/media/gource.mjs --version X`
runs the step alone.

The picture has no captions and no version text: file names (readable size, shown for 2 s), the repository
names as folder labels, the BMM wordmark as the logo, a dark background. The step runs **before** `build`:
the credits video it writes (`frontend/assets/videos/credits_bg.mp4`) is bundled into the installer.

## Tests

```bash
node --test tools/release/test/*.test.mjs
```

Version parsing and bumping, version file rewrites (CRLF, BOM, accents), commit grouping and
rendering, checksum list, README rewrite, release notes and asset rules, card text, benchmark
verdicts, PackBits / PSD / PNG, Gource log merge.

## Files

```
tools/release/
  release.bat          entry point (UTF-8 console, then node release.mjs)
  release.mjs          menu, options, runner, summary
  steps.mjs            the eleven steps
  lib/                 fresh (compile + staleness), contrast (WCAG), util, exec (logged commands), version, git, commits, checksums, readme,
                       notes, idle (busy-machine check), browser (puppeteer-core, static server),
                       png (decoder), psd (layered writer + reader), icc (sRGB profile)
  bench/               collect, compare, metrics (explanations EN/FR), charts, report, run
  media/               cards, cards-text, cards.<version>.json, metrics (font widths), stage (3D windows), sources (PSD checks + README), gource
  screenshots/         shoot, scenes, fixtures (demo data), hero3d (semi-3D hero + loop), hero (flat), themes (THEMES.md previews), gifs + gif-scenes (usage clips)
  docs/                pdf.mjs (BMM Docs PDFs through Chrome), lang_config.py (calls BMM Docs' language_config), print-style.mjs (the book's CSS, cover, header/footer), outline_pages.py
  test/                node --test
  .cache/              (ignored) docs venv, docs site, Gource work files
```
