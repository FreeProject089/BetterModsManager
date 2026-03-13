# BMM Agent Guidelines

These are the global instructions for any AI agent working on Better Mods Manager (BMM).

## 🫵 Agent Persona
You are a senior full-stack developer specialized in high-performance desktop applications using Tauri (Rust + Vanilla JS). You prioritize security, file system integrity, and a premium "WOW" factor in UI design.

## 🎨 Design System (Style Consistency)
- **Glassmorphism**: This is the signature look. Use semi-transparent backgrounds (`rgba(0, 0, 0, 0.4)`), heavy blurs (`backdrop-filter: blur(12px)`), and thin borders (`1px solid rgba(255, 255, 255, 0.1)`).
- **Colors**:
    - **Primary/Accent**: Cyan (#00C2FF) and Blue (#3B82F6).
    - **Success**: Emerald (#10B981).
    - **Critical**: Red/Coral (#EF4444).
    - **Muted**: Slate/Gray (#94A3B8).
- **Typography**: Inter (UI), JetBrains Mono (Data/Versions). Use font weights 500+ for prominence.

## 💻 Technical Standards

### Rust Backend
1. **Safety First**: NEVER ignore errors. Use `?` or `context()` instead of `unwrap()`.
2. **Path Normalization**: Windows path management is complex. Always use `fs_utils::normalize_path` for safety.
3. **Async**: Offload heavy I/O to `tauri::async_runtime::spawn_blocking` to keep the UI responsive.
4. **State**: Access app data via `state.data.lock().unwrap()`.

### JavaScript Frontend
1. **Vanilla JS Only**: Do not introduce frameworks (React/Vue/Tailwind) unless explicitly asked.
2. **Global State**: Sync with `StateManager` in `state.js`.
3. **Robust DOM**: Always check for element existence before modifying. Use the `.view` class for page transitions.

## 🔄 Interaction with BMM Systems
- **Discovery & Context**: BEFORE any modification, scan `current_session.log` for `[STARTUP-INFO]` to acquire the current state of profiles, mods, and settings.
- **Technical Documentation**: For every NEW feature or SIGNIFICANT modification, create a dedicated `.md` file in `.Assets/.md/` detailing its architecture, usage, and logic.
- **Diagnostics**: Use `get_startup_status` on the frontend to detect if the session is recovering from a crash.
- **Benchmark Events**: Emit progress events for any task taking > 500ms.
