---
description: Comprehensive workflow for implementing P2P and Hybrid sharing in BMM
---

# P2P & Hybrid Implementation Workflow

This workflow guides the implementation of decentralized and accelerated sharing features in Better Mods Manager.

## 🛠️ Step 1: Rust Backend Foundations (Chunking & Hashing)
Implement the core file segmentation logic in `src-tauri/src/fs_utils.rs`.
1. Define a `Chunk` struct and a hashing utility using SHA-256.
2. Update `list_mod_files` to generate a Merkle-tree like manifest for each mod.
3. Ensure all paths are normalized using `normalize_path` to handle Windows UNC prefixes.

## 🌐 Step 2: Network Integration (P2P Library)
Integrate a P2P networking library.
1. Add `libp2p` or `librqbit` to `Cargo.toml`.
2. Create a new module `src-tauri/src/network/p2p.rs` to manage the Swarm and Peer discovery.
3. Implement NAT traversal (UPnP) and Tracker communication.

## 📥 Step 3: Multi-Source Download Manager
Refactor the download logic to support multiple sources.
1. Modify the download command to accept both HTTP URLs and P2P Magnet links.
2. Implement a "Chunk Picker" that prioritizes P2P sources and falls back to HTTP (WebSeed) for missing pieces.
3. Add real-time verification: check each chunk's hash immediately upon receipt.

## 🎨 Step 4: UI/UX Integration (Frontend)
Update the frontend to support the new sharing modes.
1. **P2P Page**: Create a new view for managing active seeds and swarm stats.
2. **Hybrid Toggle**: Add a "P2P Acceleration" switch to the Server Repo view.
3. **Settings**: Add a "P2P" tab in Settings for bandwidth throttling and seeding rules.
4. **Visuals**: Use the current BMM aesthetic (glassmorphism, vibrant accents, sleek icons).

## 🛡️ Step 5: Security & Verification
1. Integrate the `security.rs` Ed25519 signatures into the `.bmmt` metadata.
2. Implement local tamper detection: if a mod file is modified by the user, BMM must immediately stop seeding it.
3. Ensure all P2P interactions are logged via the `bridgeLog` system to `current_session.log`.

## 🧪 Step 6: Testing & Validation
1. Test Full P2P download between two local BMM instances.
2. Test Hybrid mode by disabling the P2P source mid-download to verify HTTP failover.
3. Verify that the UI remains responsive (no deadlocks) during heavy hashing operations by using `spawn_blocking`.
