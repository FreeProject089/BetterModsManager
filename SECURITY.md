# Security policy

English · [Français](SECURITY_FR.md)

Better Mod Manager (BMM) copies files into game folders, downloads mods, catalogues and updates, and
runs a local API. We take reports seriously and thank anyone who discloses a problem responsibly.

## Supported versions

| Version | Supported |
|---|---|
| 1.0.x (latest 1.0.2) | Yes. Security fixes ship in the next 1.0.x release. |
| 0.9.12 | Bridge release only: it exists to upgrade 0.9.x installs to 1.0.x. Update instead of reporting against it. |
| 0.9.11 and older | No. |

## Reporting a vulnerability

**Do not open a public issue for a security problem.** Report it privately:

- GitHub **private vulnerability reporting**:
  [Report a vulnerability](https://github.com/FreeProject089/BetterModsManager/security/advisories/new)
  (repository Security tab, *Report a vulnerability*), or
- In BMM: **Settings & Other → Feedback & Bug Reports → Report a Bug**. The report goes to the
  maintainers, not to a public tracker. Say it is a security issue and keep exploit details short;
  we will follow up privately.
- If neither works for you, write to **[privacy e-mail address]** (the contact listed in
  [PRIVACY.md](PRIVACY.md)).

Please include:

- what an attacker can do (the impact) and what they need first (access, a crafted file, a network position);
- steps to reproduce: a minimal repo, catalogue, archive, modpack or request is ideal;
- the BMM version, Windows version, and any logs or proof of concept.

## What to expect

- We aim to acknowledge a report within 72 hours.
- After triage we tell you whether we accept it and how we plan to fix it.
- Please give us reasonable time to ship a fix before any public disclosure. We are glad to credit
  you in the advisory and the changelog.

## Scope

In scope:

- **The app**: the Rust core (`src-tauri/`) and the UI (`frontend/`), including script injection in
  the webview, custom pages and plugins escaping their permissions.
- **The installer and update chain**: BetterInstaller as configured for BMM
  (`BetterInstaller/examples/bmm/`), the signed update manifests, downgrade or swapped-package attacks.
- **Repo and catalogue formats**: Server Repo, catalogues, modpacks, `.MM` lists, launch packs,
  archives: path traversal, signature or key-pin bypass, crafted content that writes outside its target.
- **Local API, CLI and MCP server**: authentication, per-plugin permissions, anything reachable from
  another local user or a web page.
- **Privacy**: data sent without consent, or a consent receipt that can be skipped or forged.

Out of scope:

- attacks that need an already compromised machine or administrator rights;
- a malicious publisher's own signed content doing what it says it does (BMM verifies who published
  something, not whether it is good);
- the local API exposed to a network on purpose by the user (it binds `127.0.0.1` and has no rate limit);
- SmartScreen or antivirus reputation warnings;
- the website and services of BetterCommunity (report those in the BCW repository);
- missing hardening with no demonstrated impact, and findings from automated scanners without a
  working scenario.

## Security model in short

- **Signed updates**: BMM's `update-manifest.json` and BetterInstaller's `update.json` are signed
  (Ed25519) and expire; an unsigned, expired or mismatched manifest is refused. Downloads are checked
  against their SHA-256.
- **Signed repos and catalogues**: a repo or catalogue can require a signature; the publisher's key is
  pinned on first use and a change of key is shown, not silently accepted.
- **Path confinement**: every name that becomes a file path is sanitised at that boundary; archives
  (zip, 7z, rar) get a zip-slip check before anything is written.
- **Local API**: bound to `127.0.0.1`, token-based, permissions resolved from the token (never from a
  header), tokens compared in constant time.
- **Consent receipts**: every privacy or terms answer leaves a versioned, hashed, append-only receipt
  on the user's PC (Settings → Privacy → My consents).
- **Telemetry is off by default** and only starts after an explicit yes; see [PRIVACY.md](PRIVACY.md).
- **CI**: gitleaks, Semgrep, `npm audit` and `cargo audit` run on pushes to `main` and `Tdev`, on
  pull requests, and weekly for new advisories.

More detail: the "How it works → Security model" page of the documentation
(`BMM Docs/docs/how-it-works/security.md`).
