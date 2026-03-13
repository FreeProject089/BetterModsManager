---
description: Standard development workflow for Better Mods Manager (BMM)
---
# BMM Agent Workflow: Standard Development

Follow these steps for every task in the Better Mods Manager codebase to ensure consistency in code quality, style, and reliability.

## 🧠 Workflow vs. Skills: Understanding the Agent Concept
To work effectively on BMM, an AI agent distinguishes between these two concepts:

- **Workflows (The "How-To")**: These are **procedural roadmaps** like this file. They define the "path" to follow (Process, Context checks, Style rules). 
    - *Example*: Checking logs before coding, or using `isGlobalProcessing` during UI changes. 
    - *Utility*: Ensures the agent stays "in character" and follows project-specific safety rules.
- **Skills (The "Capabilities")**: these are **specialized tools or automated scripts** provided to the agent to perform specific actions.
    - *Example*: A script to analyze `data.json` integrity, or the `normalize_path` tool in Rust.
    - *Utility*: Extends the agent's reach beyond simple text editing to perform complex, validated operations.

## 1. Discovery & Context (MANDATORY)
- **Analyze Startup Logs**: Always start by reading the first 100 lines of `current_session.log`. Look for `[STARTUP-INFO]` blocks.
    - Identify the Active Profile and its mods.
    - Check for `[PANIC DETECTED]` or `Dirty session` messages.
- **Check Configuration**: Read `app.cfg`. If `prod=false`, console logs ARE redirected to the backend.
- **Verify UI State**: Check `AppSettings` in `data.json`. Verify `current_filter` and `current_sort_by` to understand the user's current view.
- **Crash Detection**: Use `get_startup_status` command. If true, the session is recovering from an uncontrolled shutdown.

- **Location**: Primary logic in `src-tauri/src/`.
- **Error Handling**: Functions MUST return `Result<T, String>`. Use `.map_err(|e| e.to_string())?` for conversion.
- **Lifecycle Management**: 
    - Any command modifying critical state must ensure the `last_session_clean` flag in `AppSettings` is handled.
    - Use `state.save()` immediately after state mutations.
- **Logging**: Use `crate::commands::crash::log_line(format!(...))` with categorized prefixes: `[MOD]`, `[FS]`, `[REPO]`, `[SHUTDOWN]`.
- **Path Handling**: Always use `normalize_path` in `fs_utils.rs`. For cleanup, use the recursive directory removal pattern to avoid leaving empty "ghost" folders (e.g., `DATIS`).
- **Commands**: All commands must be registered in the `tauri::generate_handler!` block in `main.rs`.

## 3. Frontend Development (JS/CSS)
- **Style Guidelines**: 
    - Maintain **Glassmorphism**: Use `backdrop-filter: blur()`, semi-transparent backgrounds, and subtle borders.
    - Typography: Use **Inter** for UI and **JetBrains Mono** for technical/code elements.
    - Consistency: Follow the existing color palette (Cyan/Blue for Primary, Green for Success, Red for Alerts).
- **Core Files**: 
    - `api.js`: The bridge. NEVER bypass `invoke()`.
    - `mods.js`: Mod lifecycle (Init -> Scan -> Toggle).
    - `state.js`: Use the `StateManager` publish-subscribe pattern. `appState.set(key, val)` is better than direct Proxy access for critical updates.
- **Safe UI & Persistence**: 
    - Always check for `null` or `undefined` before DOM manipulation.
    - Sync UI status (Filters/Sorting) with the backend via `update_settings` to ensure persistence across sessions.
- **Localization**: Use `data-i18n` for all static text. For dynamic text, use the `t()` helper from `i18n.js`. Never hardcode strings in French or English.
- **Aesthetics**: Every UI component must feel "premium". Use micro-animations (`transition: all 0.2s`), hover effects, and consistent spacing (`gap`, `padding`). Avoid plain HTML elements; use styled wrappers like `.profile-card` or custom modal blocks.

## 4. UI Locking & Verification
- **Global Lock**: Use `appState.isGlobalProcessing` to disable concurrent mod operations and prevent race conditions.
- **Progress Feedback**: Use `benchmark-event` (emit from Rust) to show real-time progress for I/O heavy tasks (Copying, Downloading, Syncing).
- **Manual Check**: Verify that newly imported mods are disabled by default.

## 5. Documentation
- **Implementation Plan**: Create/Update `implementation_plan.md` before starting complex work.
- **Walkthrough**: Update `walkthrough.md` with proof of work.
- **Feature Specs**: **[MANDATORY]** For any new system or major modification, create a dedicated `.md` file in `.Assets/.md/` explaining the "What, Why, and How".
- **Design Specifications**: Refer to existing docs in `.Assets/.md/` for high-level concepts (e.g., P2P, Hybrid).
