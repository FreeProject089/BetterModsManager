# Changelog v1.0.2 (since 60b5f6d, the 1.0.1 build)

1.0.2 is a big update: updating works again in one click, BMM gets an activity centre, a Tools hub, a simpler Server Repo page with followed repos, cleaner Settings and catalogues, better studios, and it keeps a proof of every privacy answer you give. It is the first release on the stable channel since 1.0.0.

## [FIXED] Updating BMM
### The installer now starts, or says why it did not
- The downloaded installer is started the way Explorer starts a program (ShellExecuteExW) instead of through a hidden PowerShell `Start-Process`. When PowerShell failed, BMM only reported « Launcher "powershell.exe" ... failed with ExitStatus(1) »; the real reason was lost.
- A failed start now says what happened in words, with the Windows error: permission prompt declined, file still held by an antivirus (retried a few times first), access denied by a security policy, or an installer that closed at once with an error code.
- An installer that asks for administrator rights gets the normal Windows permission prompt.
- BetterInstaller's updater (`uninstall.exe --update`) is started the same way, so an install under Program Files no longer falls silently back to the full download.
- The update check through BetterInstaller no longer freezes the window: it runs in the background and gives up after 45 seconds.

### Every release carries its signed update manifest
- « Update refused: this release publishes no signed update manifest » came from a release uploaded without `update-manifest.json`. Every way of publishing now builds it, lists `BMM-Setup.exe` in it with its SHA-256, signs it, checks it against the key BMM pins, and publishes every asset in one step: the release workflow, BetterInstaller's `release.ps1` and `npm run release:assets`.
- The manifest used to list a stale setup left over from an older build. It now lists exactly one installer, named explicitly, and a release carries a single installer asset.
- Both signed manifests expire 7 days after signing, so they are signed at publish time and renewed twice a week by the re-signing job.
- BMM picks the installer among the signed entries itself, so a release whose first asset is not the signed one no longer fails for nothing.

### One click: download, check, install
- « Download update » does everything from BMM, for stable releases and pre-releases: no trip to GitHub.
- The installer is checked before it runs, in this order: the release's signed `update-manifest.json`; else the release's signed `update.json`, which now lists `BMM-Setup.exe` with its SHA-256; else BMM says plainly what could not be checked and you choose « Install anyway » or « Cancel » (Cancel is the default). A file that does not match what the release declares is shown in red.
- The window says which check passed, shows the download (size, speed, time left), then « Checking the file… », then « Starting the installer… ».
- Installs made with BetterInstaller update with no questions: BMM runs `BMM-Setup.exe --update`, which waits for BMM to close, installs over it keeping your folder, components, shortcuts and choices, and starts BMM again.
- Stable or pre-release channel, an optional background check (every 6 h or daily), « Remind me tomorrow » and « Install on next launch ».
- Any failure stays in the window with its explanation, « Try again » and « Open the release page ».

### Release and versions
- One version everywhere: `package.json`, `package-lock.json`, `tauri.conf.json`, `Cargo.toml`/`Cargo.lock` and the installer configuration all say 1.0.2. The published « 1.0.1 » announced itself as 1.0.0, so installed 1.0.0 copies were never offered it.
- New gate `check-release-versions`: fails on any version mismatch, and in release mode checks that both manifests are signed for this version at publish time, that update.json names this package, and that the release carries a single installer.
- The release is published as Latest, not as a pre-release, so the stable channel and BetterInstaller see it.
- Older installs keep updating: 0.9.11 runs `BMM-Setup.exe` (the only installer on the release), 1.0.x copies installed by BetterInstaller read `update.json` + `bmm.bpkg`, other 1.0.x copies read the signed `update-manifest.json`.

## [NEW] Activity centre
- A button in the title bar shows every task BMM is running (mod activation, downloads, repo sync, scans, installs, exports, scheduled tasks, Laya jobs, benchmarks) with a progress ring and a count.
- Its panel lists running tasks with their step, progress, elapsed time and Cancel where the task can stop, and the last 30 finished ones (done, failed with the message, or cancelled).

## [NEW] BMM Tools
- A Tools hub (command palette, navigation bar, DevTools) with seven read-only tools: duplicate finder, conflict summary, disk usage per profile and mod, profile comparison, missing and orphaned mods, hash checker, manifest and catalogue validator. Every result can be copied or exported as JSON or CSV.

## [IMPROVED] Server Repo
- Simple by default: the guided steps to sync or host a repo; everything else sits in a searchable « Advanced tools » area that remembers what you opened.
- New tools: create a repo from a profile, a modpack or a folder; validate a repo; set its version; preview it as clients see it; share link; static hosting files for GitHub Pages or nginx.
- « Validate » is one fast pass with progress and Cancel, and only re-reads files that changed. « Convert » always shows a dry run, then asks before writing, with a backup and a new signature.
- Follow a repo: BMM checks it on a schedule you choose and notifies you, downloads, or applies the update (never while a game is running). BMM's own repo server serves an Atom feed and answers « not modified » when nothing changed.
- A mod keeps the same id across re-syncs, renames and re-imports; duplicates left by older versions are repaired once at start-up, after a backup.
- The page is restyled: one main card per tab, numbered steps that follow what is done, a live status card for the running server, the Advanced tools in one card. The « Your server » panel no longer shows while the server is stopped.
- Standalone mini-server: a status page (`/status`), a health check, the Atom feed `feed.xml`, resumable downloads, an optional rate limit, a `server.config.json`, and scheduled jobs (check files, sync from git, rsync or a folder, back up repo.json, rotate logs) with their last and next run on the status page. It ships with a systemd unit, a Windows task script and a README in English and French.

## [IMPROVED] Settings, catalogues, credits
- Settings: an index of every card in seven groups, a search that hides what does not match (Ctrl+F), tidier cards.
- Settings layout from the index: « Edit layout » lets you drag cards, move them with Alt+arrows, hide or show a card, and reset.
- App catalogue: each card shows its state and next action (Install, Launch, Update, Retry), filters by install state, sorting, a clear message when a source is offline, descriptions and READMEs rendered safely.
- Catalogues: one versioned format reads every older variant and the signed feeds of BetterCommunity v2; sources are cached, refreshed only when they changed, and one failing source no longer hides the others.
- Credits: code contributors generated from the history of the four repositories, with commit counts, in cleaner cards.

## [IMPROVED] Replay and Animation studios
- Replay Studio: a timeline to trim, cut anywhere, add markers, undo and redo, with live preview and lighter exports; fixes to times, size estimates, cuts and the element picker.
- Animation Studio: an animation can be a sequence of steps with their own timing, previewed live, reordered, exported and imported as JSON.

## [NEW] Proof of consent: « My consents »
- Every answer about the Terms of Service, the Privacy Policy and telemetry leaves a receipt: the document, its version, the SHA-256 of the exact text you were shown, the language, your answer (and each category), the time, where you answered (installer, first launch, Settings, a `bmm://` link, the local API, the command line, the MCP server, an import) and the BMM version.
- Receipts are keyed by a random install id, never by your Creator ID or your hardware.
- They are kept on your PC in an append-only, tamper-evident chain: an edited, removed or inserted receipt is detected.
- Settings → Privacy → **My consents** lists them, says whether the chain is intact, exports them as JSON, and can send them to the server.
- The installer hands BMM a receipt for each legal text you accepted; BMM accepts it as proof only if the text matches one it ships.
- An answer with no receipt is asked again: after an update from 1.0.x, after importing old settings, or when a document changes.
- With telemetry on, receipts are copied to the telemetry server, where they are stored append-only, without IP address or text, and can be exported or erased by install id.

## [IMPROVED] Privacy Policy and Terms of Service, rewritten
- The Privacy Policy now opens with an inventory of every connection BMM and its installer make: what, when, to whom, why, legal basis, retention, how to turn it off, and the default.
- Corrected: the installer's privacy step (*Accept all* is consent, *Essential only* a refusal), *Accept all* turning Discord Rich Presence on, and the Laya offline model downloaded during setup by default.
- New sections: who is responsible, consent receipts, what is stored on your PC, your rights and how to use them.
- English prevails if the English and French texts differ. Both documents carry a version, and BMM asks you to accept the new ones.

## [NEW] Server Repo: format versions
- A repository manifest now states the format it is written in (`format_version`), signed with the rest.
- The Server Repo page shows each repo's format, and converts an older manifest after showing what will change, keeping a backup.
- A repo written in a newer format than this BMM reads is refused with a clear message instead of half-loading.

## [IMPROVED] Laya
- Analyse the mods of this profile, of several profiles, or of every profile at once; the same mod installed in several profiles is analysed once and its suggestions apply to every copy.
- « Apply all » shows what will change, field by field, before writing anything, and the last batch can be undone.

## [IMPROVED] Tutorials
- The guide brings the control it talks about into view: it opens the tab or section it sits in and closes a dialog in the way when that dialog holds no edits.
- When a control cannot be shown, the guide says where it is, with « Show me » to try again.
- Translators get a reference of every variable a text can use.

## [NEW] Credits
- Code contributors of BMM, BetterCommunity, BMM Docs and BetterInstaller.
- Every bundled package with its link and its licence, readable in the app.

## [VISUAL] Start-up and themes
- The classic Tasky intro is back and lighter: it ends as soon as BMM is ready, can be skipped with a click or a key, and becomes a still splash under « fewer animations ». Settings → Graphics → Start-up animation: Classic, Logo (short) or Off. The version number now shows in it.
- New built-in theme: BMM Logo.

## [IMPROVED] Scheduler
- A task's permissions fold into one line (« 2 of 9 granted · Edit »), so the options stay in view.

## [IMPROVED] Library selection
- Enable / Disable no longer close selection mode after starting the job.
- Clearer icons: enable (check), disable (close), select all (list), select none (clear).
- The tag filter shows a colour dot only when the tag has no icon.
- Shorter « Multi-profile » label.

## [IMPROVED] Installer
- **Old installations**: BMM finds an older BMM (0.9.x, the 1.0.0 test build), its old data folder, cache and dead shortcuts, and offers to remove them, entirely optional: once at start-up after your data was carried across, and always in Settings › Application › Old installations. Uninstalls run the old version's own uninstaller; the old data folder can be backed up as a .zip first and is deleted only after a second confirmation.
- The privacy step asks once, cookie-banner style, with nothing pre-selected: *Essential only*, *Accept all* or *Customize*.
- *Accept all* never turns on the weekly hardware report (serial numbers, machine UUID, MAC addresses): only *Customize* can, and the card says so.
