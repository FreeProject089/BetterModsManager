# Changelog v1.0.2 (since 60b5f6d, the 1.0.1 build)

1.0.2 is the release that makes updating work again, the first one published on the stable channel since 1.0.0, and the one that keeps a proof of every privacy answer you give.

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

### A simpler update window
- Check, release notes, download, verification, install, restart: one button (« Download and install »).
- The download shows its progress in MB and resumes where it stopped if the connection drops; a resumed file that fails the check is downloaded again from the start.
- Signature and SHA-256 are checked before anything is written or started.
- Any failure stays in the window with its explanation, a « Download from the release page » button and « Try again ».

### Release and versions
- One version everywhere: `package.json`, `package-lock.json`, `tauri.conf.json`, `Cargo.toml`/`Cargo.lock` and the installer configuration all say 1.0.2. The published « 1.0.1 » announced itself as 1.0.0, so installed 1.0.0 copies were never offered it.
- New gate `check-release-versions`: fails on any version mismatch, and in release mode checks that both manifests are signed for this version at publish time, that update.json names this package, and that the release carries a single installer.
- The release is published as Latest, not as a pre-release, so the stable channel and BetterInstaller see it.
- Older installs keep updating: 0.9.11 runs `BMM-Setup.exe` (the only installer on the release), 1.0.x copies installed by BetterInstaller read `update.json` + `bmm.bpkg`, other 1.0.x copies read the signed `update-manifest.json`.

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
- A shorter, quieter start-up animation centred on the logo; nothing moves under « fewer animations ».
- New built-in theme: BMM Logo.

## [IMPROVED] Scheduler
- A task's permissions fold into one line (« 2 of 9 granted · Edit »), so the options stay in view.

## [IMPROVED] Library selection
- Enable / Disable no longer close selection mode after starting the job.
- Clearer icons: enable (check), disable (close), select all (list), select none (clear).
- The tag filter shows a colour dot only when the tag has no icon.
- Shorter « Multi-profile » label.

## [IMPROVED] Installer
- The privacy step asks once, cookie-banner style, with nothing pre-selected: *Essential only*, *Accept all* or *Customize*.
- *Accept all* never turns on the weekly hardware report (serial numbers, machine UUID, MAC addresses): only *Customize* can, and the card says so.
