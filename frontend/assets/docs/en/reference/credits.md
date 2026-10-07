# Credits & the stack

BMM is built by the Better* project and its contributors. The in-app **Credits** screen is the
authoritative list of people — it's generated from the project's own data, so it stays right when this
page would drift.

- **Website & community:** [BetterCommunity](doc-page:features/community)
- **Source & releases:** [github.com/FreeProject089](https://github.com/FreeProject089)
- **These docs:** [BMM-Docs](https://github.com/FreeProject089/BMM-Docs) — corrections welcome.

---

## What BMM is built on

Every dependency below is doing a specific job, and several were chosen over an obvious alternative
for a reason recorded in [Architecture](doc-page:how-it-works/architecture).

### The shell

| Crate | Job |
|---|---|
| `tauri` (v2) + `tauri-build` | the app shell: window, IPC, bundling. The OS webview instead of a bundled Chromium |
| `tauri-plugin-*` | `cli`, `dialog`, `fs`, `notification`, `process`, `shell`, `single-instance` |
| `windows`, `windows-sys`, `winreg` | direct Win32 where a crate would be a detour — IO priority, `CREATE_NO_WINDOW`, registry |
| `embed-resource` | the executable's icon and manifest |

### Doing the work

| Crate | Job |
|---|---|
| `mimalloc` | the allocator — *"30–60% smaller process working set"* than Windows' default |
| `rayon` | data parallelism, with a **capped** global pool and 512 KB stacks |
| `jwalk` | parallel directory walking on the hot paths (`walkdir` is kept for cold ones) |
| `blake3` | local content hashing — a tree hash, tagged `b3:` |
| `sha2` | legacy baselines, the repo wire format, and the `content_id` fingerprint |
| `zip`, `sevenz-rust2`, `unrar`, `tar`, `flate2` | archives, read from their index and never unpacked into the mods folder |
| `fs_extra`, `tempfile` | bulk filesystem operations and scratch space |
| `sysinfo` | the resource monitor and process checks |

### Talking to things

| Crate | Job |
|---|---|
| `warp` | the local HTTP API on `127.0.0.1:51274` |
| `reqwest` | outbound HTTP — catalogs, repos, updates |
| `tokio`, `tokio-util`, `futures` | the async runtime underneath both |
| `rmcp` | the MCP server, shipped as a cargo `[[example]]` — as a `[[bin]]` it broke the MSI |
| `igd`, `local-ip-address` | UPnP port mapping and LAN address discovery for repo hosting |
| `discord-rich-presence` | Discord RPC |

### Data, crypto, plumbing

| Crate | Job |
|---|---|
| `serde`, `serde_json`, `schemars` | `data.json`, every wire format, and JSON schemas |
| `ed25519-dalek` | update signature verification — **fail closed** |
| `uuid`, `rand`, `hex`, `base64`, `percent-encoding` | ids, tokens, encodings |
| `chrono` | timestamps, schedules, filename templates |
| `anyhow`, `thiserror` | error handling — `anyhow` internally, typed errors at the boundaries |
| `tracing`, `tracing-subscriber`, `backtrace` | diagnostics and crash reports |
| `regex`, `lazy_static`, `bytes` | parsing and shared statics |
| `image` | thumbnails and profile backgrounds |
| `clap`, `colored`, `comfy-table` | the CLI — parsing, colour, and tables |
| `open` | handing a URL or folder to the OS |

### Locks, keys and remote repos

| Crate | Job |
|---|---|
| `aes-gcm`, `argon2`, `zeroize` | the passphrase lock on a data export and on a mod list carrying credentials; key material wiped on drop |
| `russh`, `russh-sftp` | publishing a repository over SSH / SFTP |
| `keyring` | the creator key's sealing key in the OS keyring, off Windows (DPAPI on Windows) |

### Laya, the offline AI

| Component | Job |
|---|---|
| `convaiinnovations/laya-multilingual` | the classifier model, Apache-2.0, pinned at one revision in `laya-model.lock.json` |
| ONNX Runtime (Microsoft, MIT) | runs the model; the official DLL ships inside the model pack and is loaded after its SHA-256 is checked |
| `ort` | the Rust binding to ONNX Runtime, pinned exactly (a release candidate) |
| `tokenizers` | Hugging Face's tokenizer, the same version the Python reference is built from |

Laya **classifies** text; it never generates any. Everything it needs runs on your PC.

### The frontend

TypeScript compiled 1:1 to `frontend/js/`, with **no bundler and no framework**. What the window
loads is vendored next to it, never fetched from a CDN: **DOMPurify** (every rendered markdown is
sanitised), **marked**, **Prism** (highlighting), **KaTeX** (maths), **Mermaid** (diagrams),
**rrweb** (session replay), **GSAP** (animation), **svg-pan-zoom** and **Cropper.js**. The icon
picker's data comes from **Lucide** and **Simple Icons**; the typefaces are **Inter** and
**JetBrains Mono**. See [Architecture](doc-page:how-it-works/architecture) for what that choice does
and doesn't buy.

### BetterInstaller and the website

**BetterInstaller**, the installer and updater, is Rust with a **Slint** interface: a native window
without a browser engine. The **BetterCommunity** site is React and Vite in front of a Fastify API
on PostgreSQL, with a discord.js bot.

!!! tip "The complete list, with versions and licences"

    Credits → **Technical stack** lists every component of every group above (app shell,
    interface, Rust core, AI, fonts and icons, these docs, BetterInstaller, the site, build
    tools), each with the version that ships and its licence. It is generated at build time by
    `scripts/gen-credits.mjs` from the manifests themselves (`Cargo.lock`, `package-lock.json`,
    the licence banner of each bundled file, `laya-model.lock.json`), and a CI check fails when
    it no longer matches them, so it cannot drift the way a hand-written list does.

---

## The docs site

This site is **MkDocs** with the **Material** theme, bilingual through the i18n plugin (`page.md` +
`page.fr.md`), with Mermaid diagrams rendered natively and a small Python hook that rewrites the
BCWEB-style `:::` directives into Material admonitions. See
[Contributing to the docs](doc-page:how-it-works/extending).

---

## Licence

BMM is **free software**, released under the **GNU General Public License, version 3**
(GPL-3.0). The full text is [`LICENSE.md`](https://github.com/FreeProject089) in the
repository.

| | |
|---|---|
| **Licence** | GNU GPL v3.0 — [gnu.org/licenses/gpl-3.0](https://www.gnu.org/licenses/gpl-3.0.html) |
| **Author** | FreeProject089 |
| **Source** | [github.com/FreeProject089](https://github.com/FreeProject089) |
| **These docs** | [BMM-Docs](https://github.com/FreeProject089/BMM-Docs) |

### What the GPL means for you

Not legal advice — the licence text is what binds — but the short version, because most people
never read it:

- **Use it for anything**, including commercially, with no fee and no permission needed.
- **Read and change the source.** That is the point of the licence, not a loophole in it.
- **Share it**, modified or not — but whoever you share it with gets the same four freedoms
  you got, which is what "copyleft" means.
- **Publish your changes under the GPL too**, if you distribute a modified BMM, and say what
  you changed. Keeping a private fork to yourself is fine; shipping one without its source is
  not.
- **No warranty.** BMM writes to your destination folders. It keeps your mods out of harm's way by
  design, but the licence disclaims liability and you should still have backups.

### Third-party components

Every dependency listed above keeps its own licence — mostly MIT and Apache-2.0, which are
GPL-compatible. The in-app **Credits** screen links the full third-party notices, generated
from the project's dependency data rather than maintained by hand.

**Isometric icons** (`:icon[iso:…]`, the *Isometric* tab of the icon picker) come from three
MIT sets, redistributed unchanged apart from a sanitising pass:

| Set | Icons | Licence |
|---|---|---|
| [Isoflow isopack](https://github.com/markmanx/isopacks) | `iso:<name>` | MIT © 2023 Mark Mankarious |
| [MI2 — My Isometric Icons](https://github.com/richbl/isometric-icons) | `iso:cube-<name>` | MIT © 2018 Rich; its glyphs are Google's Material Design Icons, Apache-2.0 |
| [Jolloficons](https://github.com/gbmillz/jolloficons) | `iso:solid-<name>` | MIT © 2018 Gbolahan Fawale |

The full licence texts and the file-by-file list ship with the app, in
`frontend/assets/icons/iso/LICENSES.txt`.

!!! info "See it in the app"
    Credits → **View the tech stack**, which opens the same list generated from the project's data.
