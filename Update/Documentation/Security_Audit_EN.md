# Better Mod Manager (BMM) — Security Audit

**Date:** 2026-07-03 · **Scope:** the BMM Tauri desktop app — the Rust backend
(`src-tauri/src`) and its trust boundaries: archive extraction (zip-slip / CWE-22),
child-process spawning (CWE-78), the two network listeners (local plugin API + the
LAN "server mode" repo host), the auto-updater, and the sandboxed custom-pages
(`bmmpage://`) surface. Source review, not a released-binary pentest. Companion to
the BMM `Technical_Analysis` / `App_Features` docs.

**Headline: no high-severity issues found.** The load-bearing surfaces are defended
with the right patterns and carry explaining comments. A few low/informational notes
below — chiefly the LAN-exposed repo server's defaults and the reliance on third-party
crates for 7z/rar extraction safety.

---

## Reviewed and found SAFE

### Archive extraction — zip-slip / CWE-22 (`archive.rs`)
Mods may be stored as `.zip/.tar/.tar.gz/.7z/.rar` and are extracted to a cache dir on
demand. **Zip** extraction (the common case, serial + parallel paths) resolves every
entry through the zip crate's `enclosed_name()` — the correct zip-slip defense — and
**skips** any entry that would escape the destination. **Tar/tar.gz** go through the
`tar` crate's `unpack`, which rejects `..`/absolute members by default.

### Command injection — CWE-78 (`commands/proc.rs`)
Every child process is spawned via `hidden_command` / `hidden_tokio_command`, which
wrap `std::process::Command::new(program)` with arguments passed as an **array** (no
shell interpolation) and set `CREATE_NO_WINDOW` on Windows. No metacharacter injection
surface; the hidden-window flag also removes the console-flash side channel.

### Local plugin API — auth & isolation (`api/mod.rs`)
The plugin REST API binds to **`127.0.0.1` only** (not all interfaces). Auth:
- Admin token compared in **constant time** (`ct_eq`, CWE-208).
- Per-plugin tokens are accepted, and — crucially — the caller's identity and
  permissions are resolved **from the bearer token**, never from the spoofable
  `X-BMM-Plugin-Id` header (`require_permission`, CWE-862/863). A limited plugin cannot
  escalate by omitting/forging a header.
- CORS is restricted to a `tauri.localhost` origin allow-list.

### LAN repo "server mode" — path traversal & access control (`commands/repo_server.rs`)
This host is deliberately LAN-exposed (binds `0.0.0.0`) to share a generated repo.
Traversal is blocked correctly: it **rejects any `..`/`...` path segment up front**
(before the `full_path.starts_with(serve_dir)` check, which alone is insufficient
because `Path::starts_with` is a component-prefix match). Access is gated by a
mandatory **Creator ID** for `/mods/` downloads, a **ban** check, and an optional
**whitelist**.

### Auto-update (`commands/autoupdate.rs`)
Update metadata comes from GitHub releases over HTTPS; each per-file `download_url`
is **required to be HTTPS** (plain-HTTP swaps are refused) and every downloaded file is
**SHA-256-verified** against the manifest before it's applied.

### Sandboxed custom pages — `bmmpage://` (`commands/custom_pages.rs`)
Third-party "Page" content is served under a `bmmpage://` scheme with a strict CSP and
rendered in an **iframe `sandbox` WITHOUT `allow-same-origin`** (opaque `null` origin).
By construction it cannot reach `window.parent`, the BMM DOM, `__TAURI__`/`invoke`,
cookies/localStorage, the network, or sub-frames. Declared capabilities exist in the
manifest but **none are granted automatically** — a forward-compatible, deny-by-default
permission model. Page ids pass a `sanitize_id()` allow-list. Excellent isolation.

---

## Low-severity / defense-in-depth notes

1. **Repo "server mode" is LAN-exposed with permissive defaults** — *Low.* It binds
   `0.0.0.0`, the **whitelist is opt-in (off by default)**, and only `/mods/` files
   require a Creator ID — so repo metadata / non-mod files are readable by anyone on the
   local network while the server runs. This is the intended sharing model and traversal
   is defended, but it's worth surfacing in the UI/docs: **enable the whitelist for
   private sharing**, and prefer running it only on trusted networks. Consider offering a
   `127.0.0.1`-only bind for solo/local testing.

2. **7z / rar extraction relies on third-party crates for zip-slip safety** — *Low.*
   Unlike zip (`enclosed_name`) and tar (crate guard), `.7z` (`sevenz_rust`) and `.rar`
   (`unrar`) extraction trusts the crate to prevent path traversal. A hostile `.7z`/`.rar`
   mod archive (mods can originate from community repos) could traverse if the crate is
   vulnerable. **Recommendation:** validate each entry's relative path (reject `..` /
   absolute / drive-prefixed) after listing and before/right-after extraction, mirroring
   the zip guard — a cheap belt-and-suspenders independent of the crate.

3. **Auto-update authenticity rests on HTTPS + SHA-256-from-manifest, not an
   independent signature** — *Info.* Integrity is only as strong as the release channel:
   anyone able to publish a GitHub release (or a channel compromise) can ship an update
   whose SHA-256 matches its own manifest. Consider **code-signing update artifacts**
   (e.g. minisign/Ed25519) and verifying the signature client-side. (The sibling
   BetterInstaller already implements exactly this Ed25519 model; Windows MSI Authenticode
   signing, if used, partially mitigates.)

4. **Stale docstring** — *Info.* The comment above `PermissionDenied` in `api/mod.rs`
   still describes the deprecated "no header ⇒ admin" behaviour; the live
   `require_permission` resolves identity from the token. Update the comment to avoid
   future confusion.

5. **Launch-pack VBS/PowerShell escaping** — *Info (carried over).* The launch-pack
   builder writes user-chosen exe paths into a `.vbs` (`"`→`""`) and a PowerShell `.lnk`
   script (`'`→`''`) — the correct escapes for each context, and the input is the local
   user's **own** selected files (not a remote/other-user surface). Fine as-is; revisit
   only if launch-pack definitions ever become shareable/importable from untrusted sources.

---

## Remediation (applied 2026-07-03)

- **7z/rar zip-slip guard — FIXED.** `archive.rs` now has an independent
  `is_unsafe_rel_path()` (rejects `..`, POSIX-absolute, Windows drive-absolute and UNC)
  and applies it before extracting `.7z` (validates the whole index up front) and `.rar`
  (validates each entry before `extract_with_base`). This no longer relies solely on the
  third-party crate for path safety — it mirrors the `enclosed_name()` guarantee used for
  zip. `cargo check` green.
- **Stale permission docstring — FIXED.** The comment above `PermissionDenied` in
  `api/mod.rs` now correctly states that identity/permissions are resolved from the bearer
  token (not the spoofable header).
- **Repo server LAN defaults — accepted (documented).** The `0.0.0.0` bind is the
  intended "server mode" sharing feature; the whitelist already gates every path when
  enabled and traversal is defended. Left as a documented user choice (enable the
  whitelist / trusted networks) rather than crippling the feature.
- **Independent update signature — deferred (Info).** Adding minisign/Ed25519 signing of
  update artifacts is a feature-sized change, not a fix; current integrity is HTTPS +
  SHA-256-from-manifest. Tracked for a future release. (BetterInstaller already ships the
  Ed25519 model as a reference.)

## Recommendation summary

| Item | Severity | Status / Action |
|---|---|---|
| Zip-slip (zip/tar), command injection, plugin-API auth, repo traversal, update HTTPS+SHA-256, `bmmpage://` sandbox | — | **Safe — keep** |
| 7z/rar zip-slip via third-party crate | Low | **Fixed** — independent entry-path validation |
| Stale permission docstring | Info | **Fixed** — comment corrected |
| Repo server LAN defaults (whitelist off, metadata public) | Low | Accepted — documented user choice |
| No independent update signature | Info | Deferred — consider minisign/Ed25519 later |
| Launch-pack VBS/PS escaping | Info | Fine (local-only input) |

No blockers.

## Remediation (applied 2026-07-22)

| Item | Severity | Action |
|---|---|---|
| **rmcp RUSTSEC-2026-0189** (DNS rebinding in the Streamable HTTP transport, CVSS 8.8) | High (unreachable) | **Fixed** — rmcp 0.16 → **1.8**. BMM's MCP server is stdio-only, so the vulnerable transport was never reachable; the bump clears the advisory anyway. `cargo audit` now reports **0 vulnerabilities**. Only breakage: `ServerInfo`/`Implementation` became `#[non_exhaustive]` → built via mutate-from-`Default`. |
| **Timing-unsafe password compares** in the generated mini-server & hub-server templates (CWE-208) | Low | **Fixed** — both the new subscriber **download password** gate and the admin `Authorization` gate now use `crypto.timingSafeEqual` in `server.express.js.template` and `hub-server.js.template`. |
| **dompurify** low-severity advisory (GHSA-c2j3-45gr-mqc4) in root npm tooling | Low | **Fixed** — `npm audit fix` → 0 vulnerabilities. |
| New feature reviewed: **repo download password** | — | Header-based (`X-Repo-Password`), guarded `HeaderValue` construction on the Rust client, 401 surfaced as a typed error, exempt paths limited to dashboard/monitoring/admin/local. No secrets logged (history records only "wrong or missing password"). |

---

## New surfaces reviewed (2026-08-13)

Five capabilities were added this cycle. Each is listed with the property that makes it
safe, so a later change that removes the property is visible as a regression rather
than a refactor.

| Surface | Guard | Property that makes it safe |
|---|---|---|
| **Scheduler: run a user script** (`run_scheduled_script`) | task permission `script`, off by default | The body is written to a **file** and the interpreter is handed the file. It is never concatenated into a command line and never reaches a shell as text, so there is nothing to escape (CWE-78). The interpreter comes from a **closed table** (`powershell`/`cmd`/`bash`/`python`), so the `engine` argument can never itself become the program. The temp file is named from pid + nanosecond stamp — two tasks on the same tick cannot write each other's script — and is removed on **every** path, including a failed spawn. |
| **Scheduler: create a folder** (`create_bmm_folder`) | none needed — confined to app-data | Containment is checked on the **canonicalised parent**, not by rejecting `..` textually: a blacklist of dangerous spellings is a game you lose, and Windows offers several ways to write the same escape (CWE-22). An absolute path is refused outright rather than reinterpreted as relative. The parent must be created before it can be canonicalised, which is stated in the code so the ordering is not "simplified" into a check that runs before the thing it checks. |
| **Scheduler: task permissions** | three separate grants | `command`, `script` and `deeplink` replaced one opaque "allow custom commands" box. **Firing a deeplink was previously gated by nothing** while reaching anything the app exposes — the widest capability in the subsystem and the only one nobody had to ask for. Migration maps the old flag to `command` and `deeplink` (revoking those would break working automations) but **never** to `script`: that capability did not exist when consent was given. |
| **BetterCommunity API key** (`set_bcweb_api_key`, `bcweb_notifications`) | app-data, native process only | The key is **never handed to the web view**. The frontend can store one, ask whether one exists and clear it; it cannot read it back, so a compromised page cannot exfiltrate what it was never given. The request URL is **built in Rust from a base**, not passed in whole — otherwise the command would be an oracle that attaches the Authorization header to any host that asks. Known limitation, named rather than omitted: the key is stored **in clear** on disk. It is mitigated by scope — `notifications:read` grants reading notifications and nothing else — and by the app-data folder already being an asset worth protecting. |
| **BCWEB: admin visibility of user API keys** | `requireRole('SUPERADMIN')` | The `/admin/users/:id` endpoint is reachable by a MOD, so the key list is returned **only** to a SUPERADMIN and is `null` (not `[]`) otherwise, letting the UI distinguish "not permitted" from "none". The `hash` is never selected — it IS the credential, and a list that leaks it hands the account over instead of describing it. Revocation is scoped by `userId` as well as key id, so a mistyped id cannot reach into another account, and is idempotent. |

### Not a finding, recorded so it is not re-investigated

`/api/link/status` takes only a Creator ID and no authentication. That is correct — a
Creator ID is an identifier users hand to repo owners for whitelisting, and the endpoint
returns only a display name. It is noted here because it was **considered and rejected**
as the delivery channel for the notifications key: a secret returned there would go
straight to the people it exists to be kept from. The key is minted on the authenticated
`POST /me/creator-links` instead, which answers the account owner's own session.
