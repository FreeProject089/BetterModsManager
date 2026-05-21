<div align="center">
  <img src="frontend/assets/BMm.png" alt="Better Mod Manager" width="200" />
  
  # Better Mod Manager

  **A Modern, High-Performance Universal Mod Manager for Windows**

  ![Version](https://img.shields.io/badge/version-1.0.0-blue.svg?style=flat-square)
  ![License](https://img.shields.io/badge/license-GPL--3.0-green.svg?style=flat-square)
  ![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-important?style=flat-square)
  ![Rust](https://img.shields.io/badge/built%20with-Rust-orange?style=flat-square&logo=rust)
  ![Tauri](https://img.shields.io/badge/framework-Tauri%20v1-24C8D8?style=flat-square&logo=tauri)
  ![TypeScript](https://img.shields.io/badge/frontend-TypeScript%205.7-3178C6?style=flat-square&logo=typescript)

  [Official Website](https://freeproject089.github.io/BMM_Web/) •
  [Discord](https://discord.gg/CTaaEF9R75) •
  [Support on Ko-fi](https://ko-fi.com/I2I31ZIPPG)

  ---

</div>

## What is Better Mod Manager?

Better Mod Manager is a **next-generation mod manager** built from the ground up for performance, safety, and user experience. Unlike traditional managers that rely on fragile symlinks or lack proper conflict handling, BMM introduces the **Smart Physical Copy Engine** — a copy-based approach that gives you absolute control, reliability, and data integrity.

Whether you manage mods for DCS, Skyrim, Fallout, Cyberpunk, or any other game, BMM turns the chaos of mod conflicts into a clean, automated workflow.

---

## The Smart Physical Copy Engine

Traditional mod managers use symlinks or hardlinks that are OS-dependent, fragile, and hard to debug. BMM takes a different approach:

| Aspect | Traditional Managers | Better Mod Manager |
|--------|----------------------|-------------------|
| **Isolation** | Symlinks (fragile) | Physical copies (rock-solid) |
| **Safety** | Manual backups | Automated backups before ANY change |
| **Recovery** | Complex restoration | One-click atomic restoration |
| **Conflict detection** | Limited or absent | Real-time SHA-256 per-file verification |
| **Data loss risk** | High | None — protected by 3+ independent layers |

**How it works:**
1. Activating a mod physically copies its files into your game directory
2. Original files are automatically backed up with SHA-256 fingerprints
3. Conflicts are detected in real-time with configurable priority handling
4. One click restores any game to its exact pre-mod state

---

<div align="center">
  <img src="frontend/assets/gifs/credits_bg.gif" alt="BMM Git History Visualization (Gource)" width="100%" />

  *Gource visualization of BMM's development history*
</div>

---

## Key Features

### Management & Organization

- **Multi-Game Profiles** — Create a fully independent profile for every game in your library. Each profile gets its own game path, mod folder, activation state, custom theme, and configuration. Switch between DCS, Skyrim, Cyberpunk, or any other game in one click with zero cross-contamination.

- **Profile Disk Usage** — Async background scanning shows you exactly how much disk space each profile consumes in real time — no manual calculation needed.

- **Smart Conflict Detection** — When two mods try to install the same file, BMM catches it instantly. The priority system lets you define which mod wins, and the conflict panel shows you every collision at a glance before anything is applied.

- **Local Mod Pooling** — If two profiles share the same mod file (e.g., a shared DLL or texture), BMM reuses the single physical copy automatically. Saves gigabytes when managing large mod collections across multiple games.

- **Archive Explorer** — Preview the full directory tree inside any `.zip`, `.7z`, or `.rar` archive without extracting it first. Drag-select nodes to install only the files you need.

- **Visual Mapper** — A pan/zoom tree visualizer built for scale: renders 10 000+ files at 60 FPS, detects circular symlinks, and lets you navigate your game or mod folder structure in real time without a file manager.

- **Mod History & Audit Log** — Every activation, deactivation, update, and rollback is recorded with a timestamp, author, version tag, and optional note. Useful for debugging regressions: "which mod did I add yesterday that broke the game?"

---

### Safety & Integrity

- **Deep Integrity Engine** — BMM computes a SHA-256 fingerprint for every managed file at activation time. You can re-run a full integrity scan at any point to detect files that have been silently modified, corrupted, or deleted outside of BMM.

- **Automated Triple-Layer Backups** — Before overwriting any original game file, BMM stores the original in three independent locations: a session cache, a persistent backup folder, and a registry-linked snapshot. Even if one layer fails, your game is recoverable.

- **Thread-Safe I/O** — All file operations are protected by Rust Mutex locks. Parallel mod activations, background scans, and UI updates never race against each other — no corrupted writes, ever.

- **System Access Control** — *Full mode* gives unrestricted filesystem access (power users). *Limited mode* confines the entire JavaScript layer to your declared profile directories — the JS code literally cannot read or write anything outside your mod folders.

- **Creator ID** — A permanent Ed25519 key pair is derived from your machine's hardware fingerprint (CPU, motherboard serial, disk UUID, etc.) and sealed in the Windows registry. It identifies you uniquely as a mod author when publishing to a repository server — and remains stable across GPU swaps, RAM upgrades, and network card changes.

- **EULA Enforcement** — A bilingual (EN/FR) EULA viewer appears on first launch with mandatory scroll-to-bottom acceptance. Prevents silently shipping the app without user awareness.

---

### Mod Sharing & Synchronization

- **Server Repository Mode** — Turn any machine into a LAN or public mod server in one click. Clients connect by URL and receive a signed snapshot of the repository. Only changed files are transferred on sync (delta sync) — bandwidth-efficient even for 50 GB mod packs.

- **Creator ID Signing** — Every repository snapshot is signed with the author's Ed25519 private key before publishing. Clients verify the signature automatically before applying any update — no man-in-the-middle attack can inject tampered mods.

- **Direct Install (`bmm://`)** — Web pages can link to mods using the custom `bmm://` URI scheme. Clicking the link opens BMM and pre-fills the install dialog — one-click mod installation directly from a browser.

- **Modpack System (.bmp)** — Bundle an entire mod setup (files + metadata + priority order + SHA-256 checksums) into a single `.bmp` archive. Recipients can install, verify, or auto-repair the full pack with one action.

- **.MM Export Format** — Export a complete profile configuration — mod list, priorities, dependency tree, and manifests — as a single `.MM` file that can be imported on any machine running BMM.

---

### Automation & AI Integration

- **Launch Packs** — Group any combination of `.exe`, `.bat`, and `.ps1` files into a named launch pack. One click silently starts DCS, a voice comms app, a TrackIR driver, and a custom script in the right order — no more hunting through taskbar.

- **MCP Server** — Expose BMM's full capabilities to AI agents via JSON-RPC 2.0. Claude, Gemini, or any MCP-compatible agent can list mods, activate profiles, check integrity, sync repositories, and analyze crash logs — all through natural language.

- **Advanced CLI** — Headless control for scripts and CI pipelines: `bmm-mcp-server.exe list-mods --profile dcs`, `sync-profile`, `activate-mod`, `export-modpack`, `analyze-crashes`. All commands return structured JSON.

---

### Community & Ecosystem

- **Dynamic i18n** — Full English and French UI with hot-swap at runtime (no restart). The translation system is file-based and template-driven — adding a new language requires only a JSON file.

- **Interactive Help & Docs** — 35+ Mermaid architecture diagrams with pan/zoom navigation, a semantic search engine that understands concepts (search "safety" and find backup/integrity/restore topics), the Tasky mascot for contextual tips, and step-by-step interactive tutorials.

- **Discord Rich Presence** — Shows your active game profile, current mod count, and whether you're hosting a repository server — visible to friends in Discord without any setup.

- **BetaHub Integration** — One-click structured bug reports sent directly from inside BMM. Includes automatic context capture (OS version, profile state, recent actions) and proof-of-work spam protection.

---

### Performance & Optimization

- **Disk I/O Limiter** — Set a maximum transfer speed (MB/s) for mod activations. Prevents BMM from saturating your disk and causing stutters in other apps or background games.

- **Real-Time Performance Monitor** — A draggable overlay tracks CPU, RAM, and disk I/O while BMM is running. Timeline scrubbing lets you replay the performance graph, and CSV export feeds data into external analysis tools.

- **Storage Manager** — Full filesystem analysis across all drives: used/free space, SSD vs HDD detection, critical space alerts, and per-profile storage breakdowns.

- **Built-in Benchmark** — Measures your disk's sequential read/write speed without leaving BMM — useful for diagnosing slow mod activation or verifying SSD health.

---

## Technical Stack

| Layer | Technology | Details |
|:------|:-----------|:--------|
| **Backend** | Rust (stable) | Tauri v1, Tokio, Reqwest, Serde, Zip-rs, thread-safe Mutex |
| **Frontend** | TypeScript 5.7 (Strict) | Compiled to ES2022, vanilla DOM, zero frameworks |
| **Styling** | CSS3 | Custom properties, glassmorphism, fully responsive |
| **Cryptography** | ed25519-dalek 2.x + sha2 0.10 | Ed25519 signing, SHA-256 integrity checks |
| **Data Persistence** | serde_json | AppData/Roaming local storage |
| **IPC** | Tauri Commands & Events | Type-safe, async Rust ↔ TypeScript communication |
| **Windows Integration** | winreg 0.52 | Registry persistence for Creator ID sealing |

**Performance targets: (approximate)**
- Idle RAM: ~30 MB
- Active RAM: < 130 MB
- UI framerate: 60 FPS
- Cold boot: < 1.5 s

---

## Quick Start

### Prerequisites
- **Windows** 10 or 11 (64-bit)
- [Node.js](https://nodejs.org/) LTS
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- [Tauri v1 prerequisites](https://tauri.app/v1/guides/getting-started/prerequisites) (WebView2, Visual C++ build tools)

### Development Setup

```bash
# 1. Clone the repository
git clone https://github.com/FreeProject089/BetterModsManager.git
cd BetterModsManager

# 2. Install JS dependencies
npm install

# 3. Start development server (hot-reload)
npm run dev

# 4. Build a production installer
npm run build
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Tauri dev server with TypeScript watch |
| `npm run build` | Compile TS + build Windows installer |
| `npm run watch` | TypeScript watch mode only |
| `npm run typecheck` | Type-check without compiling |

---

## Documentation & Guides

| Resource | Link |
|----------|------|
| Feature Overview | [App_Features_EN.md](Update/Documentation/App_Features_EN.md) |
| Technical Architecture | [Technical_Analysis_EN.md](Update/Documentation/Technical_Analysis_EN.md) |
| Creator ID System | [creator_id.md](.Assets/.md/creator_id.md) |
| Server Repository Guide | [REPOS_GUIDE_EN.md](Update/Guides/REPOS_GUIDE_EN.md) |
| Docker Deployment | [DOCKER_GUIDE_EN.md](Update/Guides/DOCKER_GUIDE_EN.md) |
| MCP Tools Reference | [MCP_Tools_List_EN.md](Update/Guides/MCP_Tools_List_EN.md) |
| CLI Reference | [BMM_CLI_Guide_EN.md](Update/Guides/BMM_CLI_Guide_EN.md) |
| Translation Guide | [TranslationGuide_EN.md](Update/Documentation/TranslationGuide_EN.md) |
| Changelog v1.0.0 | [changelog_v1.0.0_EN.md](Update/changelog_v1.0.0_EN.md) |

### Get Help
- **Official Website** — https://freeproject089.github.io/BMM_Web/
- **Discord** — [Join the server](https://discord.gg/CTaaEF9R75)
- **Bug Reports** — [GitHub Issues](https://github.com/FreeProject089/BetterModsManager/issues) or the **BetaHub** button inside the app
- **Support Development** — [Ko-fi](https://ko-fi.com/I2I31ZIPPG)

---

## License

Better Mod Manager is licensed under the **GNU General Public License v3.0 (GPL-3.0)**.

You are free to use, modify, and distribute BMM. See [LICENSE.md](LICENSE.md) for full details.

---

<div align="center">

  **Made with ❤️ for the Modding Community**

  [Website](https://freeproject089.github.io/BMM_Web/) •
  [GitHub](https://github.com/FreeProject089/BetterModsManager) •
  [Discord](https://discord.gg/CTaaEF9R75) •
  [Ko-fi](https://ko-fi.com/I2I31ZIPPG)

</div>
