# Better Mod Manager (BMM)

A modern, high-performance, and universal mod manager built with Rust and Tauri. Designed for performance, safety, and a premium "workstation" user experience across any PC game.

## Overview

Better Mod Manager (BMM) simplifies the process of managing, installing, and sharing mods. Unlike traditional managers that rely on unstable symlinks, BMM uses a "Smart Physical Copy" engine with automated backup and restoration layers.

## Key Features

- **Multi-Game Profiles**: Manage multiple games independently with dedicated paths and visual themes.
- **Smart Activation**: Physical file installation with automatic backups of original game files.
- **Conflict Detection**: Real-time monitoring of file collisions between active mods.
- **Mod Sharing (.MM)**: Export and import complete mod configurations, including download links and installation priorities.
- **Local Mod Pooling**: Automatically detects and copies mods already present in other profiles to save bandwidth.
- **Integrity Reporting**: Diagnostic tool to verify if modded files have been corrupted or overwritten by game updates.
- **Archive Explorer**: Built-in tree view for navigating .zip and .rar contents without extraction.

## Technical Stack

- **Backend**: Rust 1.70+ (Tauri, Reqwest, Zip-rs)
- **Frontend**: ES6+ JavaScript, CSS3 (Vanilla), HTML5
- **Performance**: Low memory footprint (<80MB RAM), 60FPS responsive UI.
- **Safety**: Thread-safe I/O operations with global Mutex locking.

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
   npm run tauri dev
   ```
4. Build for production:
   ```bash
   npm run tauri build
   ```

## Documentation

Detailed documentation is available in the `Update/` directory:
- [User Guide & Features](Update/App_Features.md)
- [Technical Architecture Analysis](Update/Technical_Analysis.md)

## License

This project is licensed under the Apache License 2.0.
