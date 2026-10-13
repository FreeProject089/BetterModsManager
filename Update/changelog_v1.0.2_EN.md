# Changelog v1.0.2 (since 60b5f6d, the 1.0.1 build)

1.0.2 is the release that makes updating work again, and the first one published on the stable channel since 1.0.0.

## [FIXED] Updating BMM
### The installer now starts, or says why it did not
- The downloaded installer is started the way Explorer starts a program (ShellExecuteExW) instead of through a hidden PowerShell `Start-Process`. When PowerShell failed, BMM only reported « Launcher "powershell.exe" ... failed with ExitStatus(1) »; the real reason was lost.
- A failed start now says what happened in words, with the Windows error: permission prompt declined, file still held by an antivirus (retried a few times first), access denied by a security policy, or an installer that closed at once with an error code.
- An installer that asks for administrator rights gets the normal Windows permission prompt.
- BetterInstaller's updater (`uninstall.exe --update`) is started the same way, so an install under Program Files no longer falls silently back to the full download.
- The update check through BetterInstaller no longer freezes the window: it runs in the background and gives up after 45 seconds.

### Every release carries its signed update manifest
- « Update refused: this release publishes no signed update manifest » came from a release uploaded without `update-manifest.json`. The release pipeline now always builds it, lists `BMM-Setup.exe` in it with its SHA-256, signs it, checks it against the key BMM pins, and publishes every asset in one step.
- The manifest used to list a stale setup left over from an older build (`Better Mod Manager_1.0.0_x64-setup.exe`). It now lists exactly one installer, named explicitly.
- BMM picks the installer among the signed entries itself; the link shown by the release check only chooses between them, so a release whose first asset is not the signed one no longer fails for nothing.

### A simpler update window
- Check, release notes, download, verification, install, restart: one button (« Download and install »).
- The download shows its progress in MB and resumes where it stopped if the connection drops; a resumed file that fails the check is downloaded again from the start.
- Signature and SHA-256 are checked before anything is written or started.
- Any failure stays in the window with its explanation, a « Download from the release page » button and « Try again ».

### Release and versions
- One version everywhere: `package.json`, `package-lock.json`, `tauri.conf.json`, `Cargo.toml`/`Cargo.lock` and the installer configuration all say 1.0.2. The published « 1.0.1 » announced itself as 1.0.0 (setup, package and update.json), so installed 1.0.0 copies were never offered it.
- New gate `check-release-versions`: fails on any version mismatch, and in release mode checks that both manifests are signed for this version at publish time, that update.json names this package, and that the release carries a single installer.
- The release is published as Latest, not as a pre-release, so the stable channel and BetterInstaller see it.
- Older installs keep updating: 0.9.11 runs `BMM-Setup.exe` (the only installer on the release), 1.0.x copies installed by BetterInstaller read `update.json` + `bmm.bpkg`, other 1.0.x copies read the signed `update-manifest.json`.

## [IMPROVED] Library selection
- Enable / Disable no longer close selection mode after starting the job.
- Clearer icons: enable (check), disable (close), select all (list), select none (clear).
- The tag filter shows a colour dot only when the tag has no icon.
- Shorter « Multi-profile » label.
