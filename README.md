<p align="center">
  <img src="frontend/assets/BetterMM.png" alt="BMM Logo" width="200" />
</p>

# Better Mod Manager (BMM)

<p align="center">
  <img src="https://img.shields.io/badge/version-0.9.9-blue.svg?style=for-the-badge" alt="Version" />
  <img src="https://img.shields.io/badge/license-GPL--3.0-green.svg?style=for-the-badge" alt="License" />
  <img src="https://img.shields.io/badge/Rust-1.70%2B-orange?style=for-the-badge&logo=rust" alt="Rust" />
  <img src="https://img.shields.io/badge/Tauri-Desktop-24C8D8?style=for-the-badge&logo=tauri" alt="Tauri" />
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
- **Multi-Game Profiles**: Dedicated paths, visual themes, and configurations for every game in your library.
- **Conflict Detection**: Real-time monitoring of file collisions between active mods with intelligent priority handling.
- **Local Mod Pooling**: Save bandwidth and disk space by automatically detecting mods already present in other profiles.
- **Archive Explorer**: Navigate `.zip` and `.rar` contents with a built-in tree view - no extraction required.

### Safety & Integrity
- **Integrity Reporting**: Diagnostic tools to verify if modded files have been corrupted or overwritten by game updates.
- **Physical Backup Layer**: Safety first - your original game files are protected by automated restoration layers.
- **Thread-Safe I/O**: High-speed file operations protected by global Mutex locking for maximum stability.
- **End User License Agreement (EULA)**: BMM includes an integrated EULA to ensure safe and compliant usage for all users.

### Ecosystem & Community
- **.MM Mod Sharing**: Export/Import complete configurations, including download links and installation priorities.
- **Reddit Community**: Join our official [r/BetterModsManager](https://www.reddit.com/r/BetterModManager/) for support, updates, and community sharing.
- **Dynamic i18n**: Fully extensible translation system (FR/EN) with auto-discovery and FlagCDN integration.
- **Interactive Documentation**: Technical architecture visualized through dynamic Mermaid.js diagrams with Tasky mascot guidance.

### Administration Suite
- **Server Suite**: Integrated tools for live monitoring, IP whitelisting, and creator key management with a premium glassmorphic UI.

## Technical Stack

- **Backend**: Rust 1.70+ (Tauri, Reqwest, Zip-rs)
- **Frontend**: Modular ES2022 JavaScript, Vanilla CSS3 (Glassmorphism), HTML5
- **Performance**: Low memory footprint (less than 80MB RAM), 60FPS fluid responsive UI.
- **Safety**: Safe concurrency and memory management provided by the Rust compiler.

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
- [User Guide & Features](Update/Documentation/App_Features_EN.md)
- [Technical Architecture](Update/Documentation/Technical_Analysis_EN.md)
- [Latest Changelog (EN)](Update/Updates/changelog_since_7e839e_EN.md) | [Changelog (FR)](Update/Updates/changelog_since_7e839e_FR.md)

## License
This project is licensed under the **GNU General Public License v3.0 (GPL-3.0)**. See the [LICENSE.md](LICENSE.md) file for details.

---
<p align="center">
  Built with passion for the Modding Community
</p>
