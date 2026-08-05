# Credits & the stack

BMM is built by the Better* project and its contributors. The in-app **Credits** screen is the
authoritative list of people — it's generated from the project's own data, so it stays right when this
page would drift.

- **Website & community:** [BetterCommunity](doc-page:../features/community)
- **Source & releases:** [github.com/FreeProject089](https://github.com/FreeProject089)
- **These docs:** [BMM-Docs](https://github.com/FreeProject089/BMM-Docs) — corrections welcome.

---

## What BMM is built on

Every dependency below is doing a specific job, and several were chosen over an obvious alternative
for a reason recorded in [Architecture](doc-page:../how-it-works/architecture).

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
| `zip`, `sevenz-rust`, `unrar`, `tar`, `flate2` | archives, read from their index and never unpacked into the mods folder |
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

### The frontend

TypeScript compiled 1:1 to `frontend/js/`, with **no bundler and no framework**. The only runtime
dependency of consequence is **rrweb** for session replay. See
[Architecture](doc-page:../how-it-works/architecture) for what that choice does and doesn't buy.

---

## The docs site

This site is **MkDocs** with the **Material** theme, bilingual through the i18n plugin (`page.md` +
`page.fr.md`), with Mermaid diagrams rendered natively and a small Python hook that rewrites the
BCWEB-style `:::` directives into Material admonitions. See
[Contributing to the docs](doc-page:../how-it-works/extending).

---

## Licences

Each dependency keeps its own licence. BMM's own licence is in the
[repository](https://github.com/FreeProject089); the in-app Credits screen links the third-party
notices.

!!! info "See it in the app"
    Credits → **View the tech stack**, which opens the same list generated from the project's data.
