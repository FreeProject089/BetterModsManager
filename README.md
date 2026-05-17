<p align="center">
  <img src="frontend/assets/BetterMM.png" alt="BMM Logo" width="200" />
</p>

# Better Mod Manager (BMM)

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-blue.svg?style=for-the-badge" alt="Version" />
  <img src="https://img.shields.io/badge/license-GPL--3.0-green.svg?style=for-the-badge" alt="License" />
  <img src="https://img.shields.io/badge/Rust-1.70%2B-orange?style=for-the-badge&logo=rust" alt="Rust" />
  <img src="https://img.shields.io/badge/Tauri-Desktop-24C8D8?style=for-the-badge&logo=tauri" alt="Tauri" />
  <img src="https://img.shields.io/badge/TypeScript-Strict-3178C6?style=for-the-badge&logo=typescript" alt="TypeScript" />
</p>

<p align="center">
  <b>Official Website:</b> <a href="https://freeproject089.github.io/BMM_Web/">https://freeproject089.github.io/BMM_Web/</a>
</p>

<p align="center">
  <a href="https://ko-fi.com/I2I31ZIPPG" target="_blank">
    <img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Support on Ko-fi" style="height:45px;width:auto;" />
  </a>
</p>

---

**Better Mod Manager (BMM)** is a modern, high-performance, and universal mod manager built with **Rust** and **Tauri**. Designed for performance, safety, and a premium "workstation" user experience, it redefines how you manage game modifications across any PC title.

**Important Note:** BMM is currently **Windows Only**.

## The "Smart Physical Copy" Engine
Unlike traditional managers that rely on unstable symlinks or hardlinks, BMM uses a proprietary **Smart Physical Copy** engine. It provides:
- **Physical Isolation**: Mods are physically moved to the game directory only when activated.
- **Automated Backups**: Original game files are automatically backed up before any modification.
- **Atomic Restorations**: One-click restoration of the original game state, guaranteed.

## Key Features

### Management & Performance
- **Multi-Game Profiles**: Dedicated paths, visual themes (110+ icons, custom colors, background images), and configurations for every game in your library.
- **Profile Disk Usage**: Real-time display of disk space consumed by each profile's mod folder, loaded asynchronously on the Profiles view.
- **Conflict Detection**: Real-time monitoring of file collisions between active mods with intelligent priority handling.
- **Local Mod Pooling**: Save bandwidth and disk space by automatically detecting mods already present in other profiles.
- **Archive Explorer**: Navigate `.zip` contents with a built-in tree view — no extraction required.
- **Visual Mapper**: Interactive directory tree with infinite recursion depth, cycle detection, virtual scrolling (10 000+ files at 60 FPS), and direct shell integration.
- **Updates History**: Persistent audit log of all mod metadata changes (author, version, tags, links) with action filtering and configurable retention.

### Safety & Integrity
- **Deep Integrity Engine**: SHA-256 cryptographic verification of every installed file. Pulsing red shield indicates compromised mods in real-time.
- **Physical Backup Layer**: Original game files are protected by automated restoration layers.
- **Thread-Safe I/O**: High-speed file operations protected by global Mutex locking.
- **System Access Control**: Full vs. Limited access mode — restrict the JS interface to profile-defined folders only.
- **EULA**: Mandatory acceptance during installation, with integrated viewer and bilingual support (EN/FR).

### Mod Sharing & Sync
- **.MM Mod Sharing**: Export/Import complete configurations with download links, priorities, and full file trees. Export can be cancelled mid-operation.
- **Server Repository (Server Mode)**: Host a mod server with SHA-256 manifest, smart sync (only download changed files), live client monitoring, whitelist/ban management.
- **Verified Server Browse**: The built-in repo browser only displays servers with a validated hash — ensuring quality and authenticity.
- **One-Click Install (`bmm://`)**: Install mods directly from web links using a registered protocol handler.
- **Modpack System (.bmp)**: Bundle, share, verify, and auto-repair mod collections with per-file SHA-256 manifests.

### Automation & AI Integration (v1.0.0)
- **Launch Packs**: Group multiple apps (`.exe`, `.bat`, `.ps1`) into a single silent execution unit with auto-generated icons and desktop shortcuts.
- **MCP Server**: Connect BMM to AI agents (Claude, Gemini) via JSON-RPC 2.0 over stdio. 25+ tools exposed for profiles, mods, sync, diagnostics, and repositories.
- **Advanced CLI**: Full terminal control over BMM — list mods, sync profiles, analyze crashes, run launch packs — via `bmm-mcp-server.exe`.

### Ecosystem & Community
- **Dynamic i18n**: 100% EN/FR coverage, fully extensible with community language files.
- **Interactive Documentation (Help & Other)**: 35+ Mermaid.js diagrams with pan/zoom, dual-mode semantic search (Classic + NLP Semantic with synonym expansion), Tasky mascot guidance, Docker/ngrok deployment guide, and comprehensive FAQ.
- **Discord Rich Presence**: Live status showing active profile, mod count, and server hosting state.
- **BetaHub Integration**: Structured bug reporting with proof-of-work spam protection.

### Performance & Storage
- **Disk I/O Limiter**: Cap transfer speed per disk to prevent system freezes during heavy operations.
- **Performance Monitor**: Real-time CPU/RAM/Disk overlay with timeline scrubbing and CSV export.
- **Storage Manager**: SSD/HDD detection, filesystem analysis, and critical/warning disk alerts.
- **Benchmark Tool**: Real-world disk performance testing directly within BMM.

## Technical Stack

| Layer | Technology |
|:---|:---|
| **Backend** | Rust 1.70+ (Tauri v1, Reqwest, Zip-rs, Tokio, Serde) |
| **Frontend** | Strict TypeScript (ES2022) + Vanilla JS compiled output |
| **Styling** | Vanilla CSS3 (CSS Custom Properties, Glassmorphism) |
| **Data** | JSON persistence via `serde_json`, AppData/Roaming |
| **IPC** | Tauri Commands + Events (async, type-safe) |

**Performance:** ~60 MB RAM idle, < 130 MB active, 60 FPS UI, < 1.5s cold boot.

## Installation & Development

### Prerequisites
- [Node.js](https://nodejs.org/) (LTS recommended)
- [Rust](https://www.rust-lang.org/tools/install)
- [Tauri Dependencies](https://tauri.app/v1/guides/getting-started/prerequisites)

### Setup
1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run in development mode:
   ```bash
   npm run dev
   ```
4. Build for production:
   ```bash
   npm run build
   ```

## Documentation
- [User Guide & Features (EN)](Update/Documentation/App_Features_EN.md) | [(FR)](Update/Documentation/App_Features_FR.md)
- [Technical Architecture (EN)](Update/Documentation/Technical_Analysis_EN.md) | [(FR)](Update/Documentation/Technical_Analysis_FR.md)
- [Changelog v1.0.0 (EN)](Update/changelog_v1.0.0_EN.md) | [(FR)](Update/changelog_v1.0.0_FR.md)
- [Docker Deployment Guide (EN)](Update/Guides/DOCKER_GUIDE_EN.md) | [(FR)](Update/Guides/DOCKER_GUIDE_FR.md)
- [Server Repo Guide (EN)](Update/Guides/REPOS_GUIDE_EN.md) | [(FR)](Update/Guides/REPOS_GUIDE_FR.md)

## License
This project is licensed under the **GNU General Public License v3.0 (GPL-3.0)**. See the [LICENSE.md](LICENSE.md) file for details.

---
<p align="center">
  Built with passion for the Modding Community — <a href="https://www.reddit.com/r/BetterModManager/">r/BetterModsManager</a>
</p>
