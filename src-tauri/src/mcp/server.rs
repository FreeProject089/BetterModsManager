use rmcp::{ServerHandler, model::*, service::RequestContext, RoleServer};
use serde_json::json;

use crate::mcp::tools::{profiles, mods, diagnostics, launch_packs, search};
use crate::mcp::state_bridge;

/// The BMMScript vocabulary, as `scripts/gen-bmms-reference.mjs` generates it.
///
/// Baked into the binary because an MCP client is usually somewhere else entirely — reading
/// it from a path beside the executable would make the one tool whose whole job is "tell me
/// what the words are" the one that fails when it is needed.
pub const BMMS_VOCABULARY: &str = include_str!("../../../dist-assets/bmms-vocabulary.json");

#[derive(Clone)]
pub struct BmmMcpServer;

/// Helper to serialize any Serialize type to a tool result
fn ok_json<T: serde::Serialize>(val: &T) -> Result<rmcp::model::CallToolResult, rmcp::ErrorData> {
    let text = serde_json::to_string_pretty(val)
        .map_err(|e| rmcp::ErrorData::internal_error(format!("Serialization error: {}", e), None))?;
    Ok(CallToolResult::success(vec![Content::text(text)]))
}

fn err_result(msg: &str) -> Result<rmcp::model::CallToolResult, rmcp::ErrorData> {
    Ok(CallToolResult::error(vec![Content::text(msg.to_string())]))
}

impl BmmMcpServer {
    pub fn new() -> Self {
        Self
    }

    // ── Profile Tools ────────────────────────────────────────────────

    fn tool_list_profiles(&self) -> Result<CallToolResult, rmcp::ErrorData> {
        match profiles::list_profiles() {
            Ok(profiles) => ok_json(&profiles),
            Err(e) => err_result(&e),
        }
    }

    fn tool_get_profile(&self, profile_id: &str) -> Result<CallToolResult, rmcp::ErrorData> {
        match profiles::get_profile_details(profile_id) {
            Ok(details) => ok_json(&details),
            Err(e) => err_result(&e),
        }
    }

    fn tool_get_active_profile(&self) -> Result<CallToolResult, rmcp::ErrorData> {
        match profiles::get_active_profile() {
            Ok(Some(profile)) => ok_json(&profile),
            Ok(None) => ok_json(&json!({"message": "No active profile set"})),
            Err(e) => err_result(&e),
        }
    }

    fn tool_set_active_profile(&self, profile_id: &str) -> Result<CallToolResult, rmcp::ErrorData> {
        match profiles::set_active_profile(profile_id) {
            Ok(msg) => Ok(CallToolResult::success(vec![Content::text(msg)])),
            Err(e) => err_result(&e),
        }
    }

    // ── Mods Tools ───────────────────────────────────────────────────

    fn tool_list_mods(&self, profile_id: Option<&str>, filter: Option<&str>) -> Result<CallToolResult, rmcp::ErrorData> {
        match mods::list_mods(profile_id, filter) {
            Ok(mods_list) => {
                let count = mods_list.len();
                let result = json!({
                    "count": count,
                    "mods": mods_list,
                });
                ok_json(&result)
            }
            Err(e) => err_result(&e),
        }
    }

    fn tool_get_mod(&self, mod_id: &str) -> Result<CallToolResult, rmcp::ErrorData> {
        match mods::get_mod_details(mod_id) {
            Ok(details) => ok_json(&details),
            Err(e) => err_result(&e),
        }
    }

    fn tool_search_mods(&self, query: &str) -> Result<CallToolResult, rmcp::ErrorData> {
        match mods::search_mods(query) {
            Ok(results) => {
                let result = json!({
                    "query": query,
                    "result_count": results.len(),
                    "results": results,
                });
                ok_json(&result)
            }
            Err(e) => err_result(&e),
        }
    }

    fn tool_search(&self, query: &str, limit: usize) -> Result<CallToolResult, rmcp::ErrorData> {
        match search::search_all(query, limit) {
            Ok(res) => ok_json(&serde_json::to_value(&res).unwrap_or_default()),
            Err(e) => err_result(&e),
        }
    }

    fn tool_set_mod_enabled(&self, mod_id: &str, enabled: bool) -> Result<CallToolResult, rmcp::ErrorData> {
        match mods::set_mod_enabled(mod_id, enabled) {
            Ok(msg) => Ok(CallToolResult::success(vec![Content::text(msg)])),
            Err(e) => err_result(&e),
        }
    }

    fn tool_sync_active_profile(&self) -> Result<CallToolResult, rmcp::ErrorData> {
        match mods::sync_active_profile() {
            Ok(msg) => Ok(CallToolResult::success(vec![Content::text(msg)])),
            Err(e) => err_result(&e),
        }
    }

    // ── Documentation & Lang Tools ────────────────────────────────────

    fn tool_get_documentation_list(&self) -> Result<CallToolResult, rmcp::ErrorData> {
        match mods::get_documentation_list() {
            Ok(docs) => ok_json(&docs),
            Err(e) => err_result(&e),
        }
    }

    fn tool_read_documentation(&self, file_name: &str) -> Result<CallToolResult, rmcp::ErrorData> {
        match mods::read_documentation(file_name) {
            Ok(content) => Ok(CallToolResult::success(vec![Content::text(content)])),
            Err(e) => err_result(&e),
        }
    }

    fn tool_get_language_list(&self) -> Result<CallToolResult, rmcp::ErrorData> {
        match mods::get_language_list() {
            Ok(langs) => ok_json(&langs),
            Err(e) => err_result(&e),
        }
    }

    fn tool_read_language_file(&self, lang_code: &str) -> Result<CallToolResult, rmcp::ErrorData> {
        match mods::read_language_file(lang_code) {
            Ok(content) => Ok(CallToolResult::success(vec![Content::text(content)])),
            Err(e) => err_result(&e),
        }
    }

    // ── Diagnostics Tools ────────────────────────────────────────────

    fn tool_get_statistics(&self) -> Result<CallToolResult, rmcp::ErrorData> {
        match diagnostics::get_statistics() {
            Ok(stats) => ok_json(&stats),
            Err(e) => err_result(&e),
        }
    }

    fn tool_list_crash_reports(&self, limit: Option<usize>) -> Result<CallToolResult, rmcp::ErrorData> {
        let reports = diagnostics::list_crash_reports(limit);
        let result = json!({
            "count": reports.len(),
            "reports": reports,
        });
        ok_json(&result)
    }

    fn tool_analyze_crash_report(&self, report_path: &str) -> Result<CallToolResult, rmcp::ErrorData> {
        match diagnostics::analyze_crash_report(report_path) {
            Ok(analysis) => ok_json(&analysis),
            Err(e) => err_result(&e),
        }
    }

    fn tool_read_crash_report(&self, report_path: &str) -> Result<CallToolResult, rmcp::ErrorData> {
        match diagnostics::read_crash_report_raw(report_path) {
            Ok(content) => ok_json(&content),
            Err(e) => err_result(&e),
        }
    }

    fn tool_generate_betahub_report(&self, title: &str, description: &str) -> Result<CallToolResult, rmcp::ErrorData> {
        match mods::generate_betahub_report(title, description) {
            Ok(report) => ok_json(&report),
            Err(e) => err_result(&e),
        }
    }

    fn tool_export_config(&self, target_path: &str) -> Result<CallToolResult, rmcp::ErrorData> {
        match mods::export_config(target_path) {
            Ok(msg) => Ok(CallToolResult::success(vec![Content::text(msg)])),
            Err(e) => err_result(&e),
        }
    }

    // ── Launch Packs Tools ───────────────────────────────────────────

    fn tool_list_launch_packs(&self) -> Result<CallToolResult, rmcp::ErrorData> {
        match launch_packs::list_launch_packs() {
            Ok(packs) => ok_json(&packs),
            Err(e) => err_result(&e.to_string()),
        }
    }

    fn tool_run_launch_pack(&self, id: &str) -> Result<CallToolResult, rmcp::ErrorData> {
        match launch_packs::run_launch_pack(id) {
            Ok(msg) => Ok(CallToolResult::success(vec![Content::text(msg)])),
            Err(e) => err_result(&e.to_string()),
        }
    }

    fn tool_delete_launch_pack(&self, id: &str) -> Result<CallToolResult, rmcp::ErrorData> {
        match launch_packs::delete_launch_pack(id) {
            Ok(msg) => Ok(CallToolResult::success(vec![Content::text(msg)])),
            Err(e) => err_result(&e.to_string()),
        }
    }

    fn tool_create_launch_pack(&self, name: &str, exes: Vec<String>, icon: Option<&str>) -> Result<CallToolResult, rmcp::ErrorData> {
        match launch_packs::create_launch_pack(name.to_string(), exes, icon.map(|s| s.to_string())) {
            Ok(pack) => ok_json(&pack),
            Err(e) => err_result(&e.to_string()),
        }
    }

    fn tool_open_launch_pack_folder(&self, id: &str) -> Result<CallToolResult, rmcp::ErrorData> {
        match launch_packs::open_launch_pack_folder(id) {
            Ok(msg) => Ok(CallToolResult::success(vec![Content::text(msg)])),
            Err(e) => err_result(&e.to_string()),
        }
    }

    // ── Plugins & API ───────────────────────────────────────────────────
    fn tool_list_plugins(&self) -> Result<CallToolResult, rmcp::ErrorData> {
        match state_bridge::list_plugins() {
            Ok(v) => ok_json(&v),
            Err(e) => err_result(&e.to_string()),
        }
    }
    fn tool_get_api_info(&self, reveal: bool) -> Result<CallToolResult, rmcp::ErrorData> {
        match state_bridge::get_api_info(reveal) {
            Ok(v) => ok_json(&v),
            Err(e) => err_result(&e.to_string()),
        }
    }

    // ── App Catalog ─────────────────────────────────────────────────────
    fn tool_list_apps(&self) -> Result<CallToolResult, rmcp::ErrorData> {
        match state_bridge::list_apps() {
            Ok(v) => ok_json(&v),
            Err(e) => err_result(&e.to_string()),
        }
    }

    // ── Feature-parity tools (modpacks, tags, repos, themes, plugins, live API) ──

    fn tool_list_modpacks(&self) -> Result<CallToolResult, rmcp::ErrorData> {
        match state_bridge::list_modpacks() {
            Ok(v) => ok_json(&serde_json::json!({ "count": v.len(), "modpacks": v })),
            Err(e) => err_result(&e.to_string()),
        }
    }

    fn tool_create_modpack(&self, name: &str, mod_ids: Vec<String>) -> Result<CallToolResult, rmcp::ErrorData> {
        match state_bridge::create_modpack(name, mod_ids) {
            Ok(msg) => Ok(CallToolResult::success(vec![Content::text(msg)])),
            Err(e) => err_result(&e.to_string()),
        }
    }

    fn tool_delete_mod(&self, mod_id: &str, delete_files: bool) -> Result<CallToolResult, rmcp::ErrorData> {
        match state_bridge::delete_mod(mod_id, delete_files) {
            Ok(msg) => Ok(CallToolResult::success(vec![Content::text(msg)])),
            Err(e) => err_result(&e.to_string()),
        }
    }

    fn tool_verify_mod_integrity(&self, mod_id: &str) -> Result<CallToolResult, rmcp::ErrorData> {
        match state_bridge::verify_integrity(mod_id) {
            Ok(map) => {
                let corrupted: Vec<&String> = map.iter().filter(|(_, ok)| !**ok).map(|(f, _)| f).collect();
                ok_json(&serde_json::json!({ "files_checked": map.len(), "corrupted": corrupted, "ok": corrupted.is_empty(), "files": map }))
            }
            Err(e) => err_result(&e.to_string()),
        }
    }

    fn tool_list_tags(&self) -> Result<CallToolResult, rmcp::ErrorData> {
        match state_bridge::list_tags() {
            Ok(v) => ok_json(&v),
            Err(e) => err_result(&e.to_string()),
        }
    }

    fn tool_list_connected_repos(&self) -> Result<CallToolResult, rmcp::ErrorData> {
        match state_bridge::list_connected_repos() {
            Ok(v) => ok_json(&v),
            Err(e) => err_result(&e.to_string()),
        }
    }

    fn tool_list_themes(&self) -> Result<CallToolResult, rmcp::ErrorData> {
        match state_bridge::list_themes() {
            Ok(v) => ok_json(&v),
            Err(e) => err_result(&e.to_string()),
        }
    }

    fn tool_get_plugin(&self, plugin_id: &str) -> Result<CallToolResult, rmcp::ErrorData> {
        match state_bridge::get_plugin(plugin_id) {
            Ok(v) => ok_json(&v),
            Err(e) => err_result(&e.to_string()),
        }
    }

    async fn tool_api_call(&self, method: &str, path: &str, body: Option<serde_json::Value>) -> Result<CallToolResult, rmcp::ErrorData> {
        match state_bridge::api_call(method, path, body).await {
            Ok(v) => ok_json(&v),
            Err(e) => err_result(&e.to_string()),
        }
    }

    fn tool_list_schedules(&self) -> Result<CallToolResult, rmcp::ErrorData> {
        match state_bridge::list_schedules() {
            Ok(v) => ok_json(&v),
            Err(e) => err_result(&e.to_string()),
        }
    }

    fn tool_create_schedule(&self, task: serde_json::Value) -> Result<CallToolResult, rmcp::ErrorData> {
        match state_bridge::save_schedule(task) {
            Ok(v) => ok_json(&v),
            Err(e) => err_result(&e.to_string()),
        }
    }

    fn tool_delete_schedule(&self, id: &str) -> Result<CallToolResult, rmcp::ErrorData> {
        match state_bridge::delete_schedule(id) {
            Ok(v) => ok_json(&v),
            Err(e) => err_result(&e.to_string()),
        }
    }

    fn tool_create_plugin_scaffold(&self, manifest: serde_json::Value, scripts: Vec<(String, String)>) -> Result<CallToolResult, rmcp::ErrorData> {
        match state_bridge::create_plugin_scaffold(manifest, scripts) {
            Ok(v) => ok_json(&v),
            Err(e) => err_result(&e.to_string()),
        }
    }

    fn tool_list_sessions(&self) -> Result<CallToolResult, rmcp::ErrorData> {
        let sessions: Vec<_> = state_bridge::list_crash_reports().into_iter()
            .filter(|r| r.category.contains("Session")).collect();
        ok_json(&serde_json::json!({ "count": sessions.len(), "sessions": sessions }))
    }

    fn tool_apply_theme(&self, theme_id: &str) -> Result<CallToolResult, rmcp::ErrorData> {
        match state_bridge::apply_theme(theme_id) {
            Ok(msg) => Ok(CallToolResult::success(vec![Content::text(msg)])),
            Err(e) => err_result(&e.to_string()),
        }
    }

    fn tool_get_theme(&self, theme_id: &str) -> Result<CallToolResult, rmcp::ErrorData> {
        match state_bridge::get_theme(theme_id) {
            Ok(v) => ok_json(&v),
            Err(e) => err_result(&e.to_string()),
        }
    }
}

// ── MCP ServerHandler Implementation ─────────────────────────────────────

impl ServerHandler for BmmMcpServer {
    fn get_info(&self) -> ServerInfo {
        // rmcp 1.x marks ServerInfo/Implementation #[non_exhaustive], so they can't be
        // built with a struct literal from outside the crate — mutate from Default instead.
        let mut imp = Implementation::default();
        imp.name = "bmm-mcp-server".to_string();
        imp.version = env!("CARGO_PKG_VERSION").to_string();
        imp.title = Some("Better Mods Manager MCP Server".to_string());
        imp.description = Some("Provides full access to BMM's data and lifecycle for AI agents.".to_string());
        imp.icons = None;
        imp.website_url = Some("https://github.com/FreeProject089/BetterModsManager".to_string());

        let mut info = ServerInfo::default();
        info.protocol_version = ProtocolVersion::V_2024_11_05;
        info.capabilities = ServerCapabilities::builder().enable_tools().build();
        info.server_info = imp;
        info.instructions = Some(
            "Better Mods Manager (BMM) MCP Server. \
             Allows AI agents to manage profiles, mods, and analyze crashes. \
             Now includes support for reading UI translation files (Lang) \
             and documentation (.md)."
                .to_string(),
        );
        info
    }

    fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<ListToolsResult, rmcp::ErrorData>> + Send + '_ {
        let tools = vec![
            // Profiles
            Tool::new(
                "bmm_list_profiles",
                "List every BMM profile with its id, name, game and folders. Start here: almost every other tool takes a profile_id from this list.",
                std::sync::Arc::new(serde_json::from_value(json!({ "type": "object", "properties": {} })).unwrap()),
            ),
            Tool::new(
                "bmm_get_active_profile",
                "Get the currently active profile.",
                std::sync::Arc::new(serde_json::from_value(json!({ "type": "object", "properties": {} })).unwrap()),
            ),
            Tool::new(
                "bmm_get_profile",
                "Get details of a specific profile.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "profile_id": { "type": "string", "description": "The profile's id, as returned by bmm_list_profiles. Not its name." } },
                    "required": ["profile_id"]
                })).unwrap()),
            ),
            Tool::new(
                "bmm_set_active_profile",
                "Make one profile the active one. This changes which mods are enabled on disk, so it is an action and not a view change.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "profile_id": { "type": "string", "description": "The profile's id, as returned by bmm_list_profiles. Not its name." } },
                    "required": ["profile_id"]
                })).unwrap()),
            ),

            // Mods
            Tool::new(
                "bmm_list_mods",
                "List mods with optional filters.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": {
                        "profile_id": { "type": "string", "description": "The profile's id, as returned by bmm_list_profiles. Not its name." },
                        "filter": { "type": "string", "enum": ["all", "enabled", "disabled"], "description": "Which mods to return. Omit for all of them." }
                    }
                })).unwrap()),
            ),
            Tool::new(
                "bmm_get_mod",
                "Get details of a specific mod.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "mod_id": { "type": "string", "description": "The mod's id, as returned by bmm_list_mods. Not its folder name or title." } },
                    "required": ["mod_id"]
                })).unwrap()),
            ),
            Tool::new(
                "bmm_search_mods",
                "Search the installed mods by free text across name, author and description. Returns the same shape as bmm_list_mods.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "query": { "type": "string", "description": "Free text matched against a mod's name, author and description. Case-insensitive." } },
                    "required": ["query"]
                })).unwrap()),
            ),
            Tool::new(
                "bmm_search",
                "Search EVERYTHING BMM knows about in one call: installed mods, profiles, and the bundled documentation pages. Use this when you do not know which kind of thing you are looking for, or to find the id to pass to a more specific tool — each hit carries a `next` field naming it. Ranking is a match quality within one response, not a rating; it is a simpler matcher than the app's own Ctrl+K palette, which stays the reference. `sources` lists which sources actually answered: a source missing there was unavailable (the docs manifest is a bundled resource and is not always locatable), which is not the same as having no matches.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "What to look for. Every word must match, so extra words narrow the results." },
                        "limit": { "type": "integer", "description": "Maximum hits (1-100, default 20)." }
                    },
                    "required": ["query"]
                })).unwrap()),
            ),
            Tool::new(
                "bmm_set_mod_enabled",
                "Enable or disable one installed mod in the active profile. Writes to disk; there is no toggle, so send the state you want.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": {
                        "mod_id": { "type": "string", "description": "The mod's id, as returned by bmm_list_mods. Not its folder name or title." },
                        "enabled": { "type": "boolean", "description": "true turns it on, false turns it off. There is no toggle: send the state you want." }
                    },
                    "required": ["mod_id", "enabled"]
                })).unwrap()),
            ),
            Tool::new(
                "bmm_sync",
                "Synchronize files for the active profile (apply mods).",
                std::sync::Arc::new(serde_json::from_value(json!({ "type": "object", "properties": {} })).unwrap()),
            ),

            // Writing an automation as CODE, reading one back as code, and being told the
            // vocabulary rather than guessing it.
            //
            // `bmm_create_schedule` takes the shape the app SAVES: a nested tree of steps,
            // conditions and loops. That is the right shape to store and a poor one to
            // AUTHOR — composing a five-step task with a loop in it means assembling a tree
            // by hand and finding out whether it was right only when the task runs.
            //
            // BMMScript is the same task as text, and its compiler reports the line and
            // column that is wrong. So the loop becomes: read the vocabulary, write the
            // source, compile it, fix what it names, save what compiled. None of these three
            // needs BMM to be running — the compiler and the vocabulary are both in this
            // binary.
            Tool::new(
                "bmm_bmms_reference",
                "The complete BMMScript vocabulary: every action type with its parameter names, every condition, every value source, the loop sources, the reserved keywords, the five permissions and the script engines. Read this BEFORE writing a task — it is generated from the same table the app's builder renders, so it cannot name an action the runner does not have, while a guessed action name produces a task that compiles and then fails at run time. It is a VOCABULARY, not a grammar: for the syntax see the shape described on bmm_compile_bmms. Works with BMM closed.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": {}
                })).unwrap()),
            ),

            Tool::new(
                "bmm_compile_bmms",
                "Compile BMMScript into the task object bmm_create_schedule takes. Returns { ok, task?, tasks?, errors:[{line,col,message}] } — pass `task` straight to bmm_create_schedule. This is the way to AUTHOR an automation: the saved JSON is a nested tree that is easy to get subtly wrong and reports nothing until the task runs, while this names the line and the column. A source file looks like: task \"Nightly scan\" { every day at 03:00 / allow script / do mods.scan() / if file exists \"C:/x\" { do app.launch(id: \"dcs\") } } — one statement per line, braces as shown. Triggers: manual | on app start | once at \"ISO\" | every 30m | every 2h | every day at HH:MM | every week on mon,tue at HH:MM | every month on 1 at HH:MM | on file \"path\" | on event \"name\" | after task \"id\" [ok|failed] | when <condition> | probe powershell every 5m { code }. Get the action and condition names from bmm_bmms_reference. Works with BMM closed.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": {
                        "source": { "type": "string", "description": "BMMScript source: one whole `task \"...\" { ... }` block, or several." }
                    },
                    "required": ["source"]
                })).unwrap()),
            ),

            Tool::new(
                "bmm_decompile_bmms",
                "Print a saved task back as BMMScript. The inverse of bmm_compile_bmms, and the way to EDIT an existing automation without rebuilding its tree by hand: read it with bmm_list_schedules, decompile it, change the text, compile it, then save it with bmm_create_schedule under the SAME id. Works with BMM closed.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": {
                        "task": { "type": "object", "description": "A task object, in the shape bmm_list_schedules returns." }
                    },
                    "required": ["task"]
                })).unwrap()),
            ),

            Tool::new(
                "bmm_create_schedule",
                "Create or update a scheduler automation (upsert by id into schedules.json). `task` is the same shape the in-app builder saves: { id?, name, description?, enabled?, trigger, steps[], perms? }. perms is { command?, script?, deeplink?, stopProcess?, delete? } — each one false unless set, and a step needing a capability the task was not granted FAILS with a message instead of running. `allowCustomCommands` is the older single flag and means command+deeplink. trigger, one of: {type:'manual'} | {type:'appStart'} | {type:'once', at:'2026-01-01T09:00'} | {type:'interval', everyMinutes:30} | {type:'hourly', everyHours:2} | {type:'dailyAt', time:'03:00'} | {type:'weeklyAt', time:'08:00', days:[1,3]} (0=Sunday) | {type:'monthlyAt', day:1, time:'00:00'} | {type:'watchFile', path:'C:/.../dcs.log'} | {type:'onEvent', event:'...'} | {type:'afterTask', taskId:'...', outcome:'any'|'ok'|'fail'} | {type:'condition', condition:{type,params}} (fires on the CHANGE to true, not repeatedly while it is true) | {type:'script', engine:'powershell'|'cmd'|'bash'|'python'|'node'|'rust', everyMinutes:5, code:'...'} (exit code 0 runs the task; needs the `script` permission). steps[] nest freely: {kind:'action', action:{type, params}} | {kind:'delay', seconds} | {kind:'waitFor', condition, timeoutSec} | {kind:'if', condition, then[], else[]} | {kind:'repeat', mode:'while'|'until'|'doWhile'|'times', condition?, times?, maxIters, everySec, steps[]} | {kind:'forEach', source:'mods'|'enabledMods'|'disabledMods'|'profiles'|'modpacks'|'themes', maxIters, everySec, steps[]} (use {item.id}/{item.name} placeholders in the body's action params) | {kind:'switch', cases:[{condition, steps[]}], default[]}. Use bmm_list_actions / bmm_list_schedules to discover action types and existing tasks. SAFETY: without an explicit enabled:true the task is created DISABLED for the user to inspect and switch on.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": {
                        "task": { "type": "object", "description": "The full task object (see tool description for the shape)." }
                    },
                    "required": ["task"]
                })).unwrap()),
            ),
            Tool::new(
                "bmm_delete_schedule",
                "Delete a scheduler automation by id (see bmm_list_schedules for ids).",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "id": { "type": "string", "description": "The scheduled task's id, as returned by bmm_list_schedules." } },
                    "required": ["id"]
                })).unwrap()),
            ),
            Tool::new(
                "bmm_create_plugin_scaffold",
                "Scaffold a COMPLETE BMM plugin DRAFT: writes plugin.json (+ README, + bundled scripts) into <app-data>/plugin-drafts/<id>/. This is authoring, NOT installation — the user zips the draft and installs it through the app's normal permission-gated flow, and scripts only ever run behind the unsafe-plugins permission. `manifest` needs at least { id, name }; optional: version, author, description, game, permissions[], tags[], website, modlist ({ required_mods:[{id,name?,optional?}], strict? }), apply_mode ('modlist'|'script'|'both'). `scripts` is an array of { name, content } written under scripts/ and auto-declared in the manifest (has_scripts is derived, never trusted). To COUPLE a plugin to an automation, create it here and then bmm_create_schedule a task whose step is { kind:'action', action:{ type:'plugin.apply', params:{ plugin:'<id>' } } } — see bmm_list_actions for everything a step can do.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": {
                        "manifest": { "type": "object", "description": "The plugin.json content ({ id, name, version?, author?, description?, game?, permissions?, tags?, website?, modlist?, apply_mode? })." },
                        "scripts": { "type": "array", "items": { "type": "object", "properties": { "name": { "type": "string", "description": "File name, written under scripts/. A plain name, not a path." }, "content": { "type": "string", "description": "The script itself, as text." } }, "required": ["name", "content"] }, "description": "Script files to bundle (plain filenames; written under scripts/)." }
                    },
                    "required": ["manifest"]
                })).unwrap()),
            ),
            Tool::new(
                "bmm_list_actions",
                "List every action type a scheduler task step may use ({ type, label, needs, group }) — the same registry the in-app builder shows. Generated from the app's source at build time. Use with bmm_create_schedule: a step is { kind:'action', action:{ type:<one of these>, params:{...} } }. Notable groups: mods/profiles, repo (sync, publish over SSH), plugins (plugin.apply couples a plugin to an automation), system (deeplink, http.request, custom.script — the escape hatches into everything else BMM exposes).",
                std::sync::Arc::new(serde_json::from_value(json!({ "type": "object", "properties": {} })).unwrap()),
            ),

            Tool::new(
        "bmm_generate_repo",
        "Generate a repository from a list of mods.",
        std::sync::Arc::new(serde_json::from_value(json!({
            "type": "object",
            "properties": {
                "name": { "type": "string", "description": "Name written into repo.json and shown to whoever connects to it." },
                "mod_ids": { "type": "array", "items": { "type": "string" }, "description": "The mods to publish, by id (from bmm_list_mods). Empty or absent publishes the active profile's mods." }
            },
            "required": ["name", "mod_ids"]
        })).unwrap()),
    ),
    // What a plugin ships besides its code.
    Tool::new(
        "bmm_plugin_assets",
        "List the files a plugin ships in its `assets/` folder — a README, config templates, sample lists, tools, sometimes a script. Each is { path, kind, size, readable } where kind is doc/script/image/data/archive/other. Reads the FOLDER, not the manifest, so a file the manifest never mentioned still appears. Works with BMM closed.",
        std::sync::Arc::new(serde_json::from_value(json!({
            "type": "object",
            "properties": { "plugin_id": { "type": "string", "description": "The plugin's id, as returned by bmm_list_plugins. Lists the files it ships." } },
            "required": ["plugin_id"]
        })).unwrap()),
    ),
    Tool::new(
        "bmm_read_plugin_asset",
        "Read one of a plugin's shipped files as text — use bmm_plugin_assets first for the paths. Only text kinds (doc, data, script) can be read; an image or an archive is refused by kind rather than returned as noise. Nothing is executed: reading a shipped script shows you what it would do. Works with BMM closed.",
        std::sync::Arc::new(serde_json::from_value(json!({
            "type": "object",
            "properties": {
                "plugin_id": { "type": "string", "description": "The plugin's id, as returned by bmm_list_plugins." },
                "path": { "type": "string", "description": "Relative to assets/, e.g. \"README.md\" or \"docs/codes.csv\"." }
            },
            "required": ["plugin_id", "path"]
        })).unwrap()),
    ),
    // Arming a task, and the doorbell one can wait on.
    //
    // Listing them is `bmm_list_schedules`, which already existed and reads data.json
    // directly — so it answers with BMM closed, which is the better behaviour for "did my
    // nightly task even exist". A second one here would have been a worse copy.
    Tool::new(
        "bmm_set_schedule_enabled",
        "Arm or disarm one saved task by id. Only `enabled` can be changed — nothing here can write a task's steps, because installing an automation with a script step in it is a decision that belongs to somebody reading it on screen.",
        std::sync::Arc::new(serde_json::from_value(json!({
            "type": "object",
            "properties": {
                "id": { "type": "string", "description": "The scheduled task's id, as returned by bmm_list_schedules." },
                "enabled": { "type": "boolean", "description": "true turns it on, false turns it off. There is no toggle: send the state you want." }
            },
            "required": ["id", "enabled"]
        })).unwrap()),
    ),
    Tool::new(
        "bmm_signal",
        "Ring a named doorbell a scheduled task may be waiting on (`wait.hook`). Use it to tell BMM that something you were doing has finished. `data` is free-form and reaches the waiting task as text.",
        std::sync::Arc::new(serde_json::from_value(json!({
            "type": "object",
            "properties": {
                "name": { "type": "string", "description": "The signal name the task waits on, e.g. \"build-done\"." },
                "data": { "description": "Anything the task should receive." }
            },
            "required": ["name"]
        })).unwrap()),
    ),
    Tool::new(
        "bmm_signals_seen",
        "Read what a doorbell was rung with. Give a `name` for the rings themselves — what was sent and when, the same view a waiting task gets — or omit it for every name with a count. Use it after `bmm_signal` to confirm the ring landed under the name a task is actually waiting on: BMM narrows a name to something that can be a key, so \"build/done\" is filed as \"build_done\" and a task waiting on the first waits forever. Reading does not consume a ring.",
        std::sync::Arc::new(serde_json::from_value(json!({
            "type": "object",
            "properties": {
                "name": { "type": "string", "description": "One doorbell. Omit to list every name with how many times it rang." },
                "since": { "type": "integer", "description": "Unix milliseconds. Only rings at or after this. Omit for every ring still held." }
            }
        })).unwrap()),
    ),
    // Catalogues.
    Tool::new(
        "bmm_list_catalogs",
        "List the catalogues this BMM follows, grouped by type (plugin, theme, preset, modpack, repo, tutorial, list). Returns `{ sources: { <type>: [url, …] }, written_at }`. `written_at` is when the app last pushed this — the lists live in the interface's own storage, so an ABSENT written_at means the app has not run since this mirror existed, which is different from following nothing.",
        std::sync::Arc::new(serde_json::from_value(json!({ "type": "object", "properties": {} })).unwrap()),
    ),
    Tool::new(
        "bmm_follow_catalog",
        "Follow a catalogue, or stop following one. Goes through the app's own screens, so the source appears in the following list with an origin and can be removed there like any other. Requires the app to be running.",
        std::sync::Arc::new(serde_json::from_value(json!({
            "type": "object",
            "properties": {
                "type": { "type": "string", "enum": ["app", "plugin", "theme", "preset", "modpack", "repo", "tutorial", "list"], "description": "Which catalogue this address is. NOT an index: an index lists catalogues of several kinds and is read by bmm_import_catalog, which decides the kind itself." },
                "url": { "type": "string", "description": "The catalogue's address (http/https)." },
                "follow": { "type": "boolean", "description": "false to stop following it. Default true." }
            },
            "required": ["type", "url"]
        })).unwrap()),
    ),
    // Everything a repo carries that is NOT a mod.
    Tool::new(
        "bmm_repo_extras",
        "List what a repo carries besides mods: plugins, scheduled automations, themes, mod lists, catalogue bundles, catalogues to follow and app sources. Each entry is { kind, id, name, description?, author?, version?, locked?, url? }. `locked: true` on a mod list means its contents are encrypted and opening it needs a passphrase. Reads the manifest only — nothing is downloaded or installed. Use bmm_repo_extra_take to act on one.",
        std::sync::Arc::new(serde_json::from_value(json!({
            "type": "object",
            "properties": {
                "url": { "type": "string", "description": "The repo URL, with or without /repo.json." },
                "password": { "type": "string", "description": "Download password, if the repo has one." }
            },
            "required": ["url"]
        })).unwrap()),
    ),
    Tool::new(
        "bmm_repo_extra_take",
        "Install ONE thing a repo carries besides mods, named by its kind and id from bmm_repo_extras. A plugin or an automation arrives DISABLED and a plugin arrives with no permissions — taking one is not a decision to run it. A catalogue or an app source is followed rather than downloaded. A mod list or a bundle is saved to disk and its path returned, because opening one asks questions (a passphrase, which credentials to accept) that belong to a person.",
        std::sync::Arc::new(serde_json::from_value(json!({
            "type": "object",
            "properties": {
                "url": { "type": "string", "description": "The repo's repo.json URL, or the folder that holds it." },
                "kind": { "type": "string", "enum": ["plugin", "task", "theme", "modlist", "bundle", "catalog", "app"], "description": "What to take out of the repo. It must be listed under `extras` in that repo's manifest; read it first with bmm_repo_info." },
                "id": { "type": "string", "description": "The entry's id, as listed in that repo's manifest under extras." },
                "password": { "type": "string", "description": "The repo's download password, if it has one. Used for this call and never stored." }
            },
            "required": ["url", "kind", "id"]
        })).unwrap()),
    ),
    // Identity keys.
    Tool::new(
        "bmm_list_keys",
        "List the identity keys BMM can prove with: each is { name, path }, plus which one is active. NAMES AND PATHS ONLY — no key material is ever returned, and there is no tool that reads a private key.",
        std::sync::Arc::new(serde_json::from_value(json!({ "type": "object", "properties": {} })).unwrap()),
    ),
    Tool::new(
        "bmm_create_key",
        "Make an identity keypair and add it to the ring. Returns the PUBLIC line — the one you give to whoever runs a protected source — and the path the private half was written to. The private half never leaves the machine and is never returned. Pick ed25519 unless a server says otherwise: every source in this protocol accepts it. A name already on the ring is refused rather than overwritten.",
        std::sync::Arc::new(serde_json::from_value(json!({
            "type": "object",
            "properties": {
                "name": { "type": "string", "description": "What to call it on the ring, e.g. \"work\"." },
                "kind": { "type": "string", "enum": ["ed25519", "ecdsa", "rsa"], "description": "ed25519 by default. ECDSA (nistp256) and RSA 4096 are for a host that predates ed25519 support; RSA takes a few seconds to generate." }
            },
            "required": ["name"]
        })).unwrap()),
    ),
    Tool::new(
        "bmm_start_repo_server",
        "Serve an exported repo folder over HTTP so others can sync from it. The folder must already hold a repo.json - use bmm_generate_repo first.",
        std::sync::Arc::new(serde_json::from_value(json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "The exported repo folder to serve - the one that holds repo.json." },
                "port": { "type": "integer", "description": "TCP port to listen on. Omit for 8080." }
            },
            "required": ["path", "port"]
        })).unwrap()),
    ),

    // Documentation & Languages
            Tool::new(
                "bmm_get_documentation_list",
                "List internal .md documentation.",
                std::sync::Arc::new(serde_json::from_value(json!({ "type": "object", "properties": {} })).unwrap()),
            ),
            Tool::new(
                "bmm_read_documentation",
                "Read an internal documentation file.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "file_name": { "type": "string", "description": "A file name from bmm_list_documentation, e.g. 'features/scheduler.md'. A path that climbs out of the docs folder is refused." } },
                    "required": ["file_name"]
                })).unwrap()),
            ),
            Tool::new(
                "bmm_get_language_list",
                "List the UI language codes BMM ships, for bmm_read_language_file. These are interface translations, not mod languages.",
                std::sync::Arc::new(serde_json::from_value(json!({ "type": "object", "properties": {} })).unwrap()),
            ),
            Tool::new(
                "bmm_read_language_file",
                "Read a language file (UI text/FAQs).",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "lang_code": { "type": "string", "description": "A code from bmm_get_language_list, e.g. 'en' or 'fr'." } },
                    "required": ["lang_code"]
                })).unwrap()),
            ),
            Tool::new(
                "bmm_generate_lightweight_server",
                "Generate a standalone lightweight server script (.bat) for a given repo.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": {
                        "repo_path": { "type": "string", "description": "The exported repo folder the generated server will serve." },
                        "port": { "type": "integer", "description": "TCP port the generated server listens on. Omit for 8080." },
                        "auto_start": { "type": "boolean", "description": "Start the server when BMM starts." },
                        "use_cloudflare": { "type": "boolean", "description": "Generate the Cloudflare Tunnel start-up as well." },
                        "use_upnp": { "type": "boolean", "description": "Ask the router to open the port automatically." },
                        "upload_limit": { "type": "integer", "description": "Outbound cap in KB/s. 0 or absent means unlimited." },
                        "server_version": { "type": "integer", "description": "1 or 2. Version 2 is the current generator." },
                        "admin_password": { "type": "string", "description": "Password for the generated server's admin page. Omit for none." },
                        "enable_docker": { "type": "boolean", "description": "Write a Dockerfile beside the scripts." },
                        "docker_host_type": { "type": "string", "description": "'linux' or 'windows' - which host the Dockerfile targets." },
                        "server_type": { "type": "string", "description": "'std' (standard) or 'lux' (premium)." }
                    },
                    "required": ["repo_path", "port", "auto_start", "use_cloudflare", "use_upnp", "upload_limit", "server_version", "admin_password"]
                })).unwrap()),
            ),

            // Diagnostics
            Tool::new(
                "bmm_get_statistics",
                "Counts and sizes across every profile: mods, enabled mods, disk used, and when each was last synced.",
                std::sync::Arc::new(serde_json::from_value(json!({ "type": "object", "properties": {} })).unwrap()),
            ),
            Tool::new(
                "bmm_list_crash_reports",
                "List the crash reports BMM has collected, newest first. Each entry carries the report_path the other crash tools take.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "limit": { "type": "integer", "description": "How many reports to return, newest first. Omit for all of them." } }
                })).unwrap()),
            ),
            Tool::new(
                "bmm_analyze_crash_report",
                "Read one crash report and summarise what most likely caused it, including which mods were loaded at the time.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "report_path": { "type": "string", "description": "A path from bmm_list_crash_reports. Reads the report and summarises the likely cause." } },
                    "required": ["report_path"]
                })).unwrap()),
            ),
            Tool::new(
                "bmm_read_crash_report",
                "Read raw content of a crash report.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "report_path": { "type": "string", "description": "A path from bmm_list_crash_reports. Returns the raw text." } },
                    "required": ["report_path"]
                })).unwrap()),
            ),
            Tool::new(
                "bmm_generate_betahub_report",
                "Generate a report for BetaHub.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": {
                        "title": { "type": "string", "description": "One line naming the problem, as a person would report it." },
                        "description": { "type": "string", "description": "What happened, what was expected, and how to reproduce it." }
                    },
                    "required": ["title", "description"]
                })).unwrap()),
            ),
            Tool::new(
                "bmm_export_config",
                "Write a copy of BMM data.json to a path you choose. It holds profiles, mods and settings - treat it as sensitive.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "target_path": { "type": "string", "description": "Where to write data.json. An existing file at that path is overwritten." } },
                    "required": ["target_path"]
                })).unwrap()),
            ),
            // Launch Packs
            Tool::new(
                "bmm_list_launch_packs",
                "List all configured Launch Packs.",
                std::sync::Arc::new(serde_json::from_value(json!({ "type": "object", "properties": {} })).unwrap()),
            ),
            Tool::new(
                "bmm_create_launch_pack",
                "Create a new Launch Pack (group of apps to launch).",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "Name of the pack" },
                        "executable_paths": { "type": "array", "items": { "type": "string" }, "description": "List of full paths to executables" },
                        "icon_source_path": { "type": "string", "description": "Optional path to an image for the icon" }
                    },
                    "required": ["name", "executable_paths"]
                })).unwrap()),
            ),
            Tool::new(
                "bmm_run_launch_pack",
                "Launch all apps in a Launch Pack.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "id": { "type": "string", "description": "ID or Name of the pack" } },
                    "required": ["id"]
                })).unwrap()),
            ),
            Tool::new(
                "bmm_delete_launch_pack",
                "Delete a Launch Pack by id. The pack is removed; the games and mods it pointed at are untouched.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "id": { "type": "string", "description": "ID or Name of the pack" } },
                    "required": ["id"]
                })).unwrap()),
            ),
            Tool::new(
                "bmm_open_launch_pack_folder",
                "Open the folder containing the Launch Pack files.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "id": { "type": "string", "description": "ID or Name of the pack" } },
                    "required": ["id"]
                })).unwrap()),
            ),
            // ── Plugins & API ──────────────────────────────────────────
            Tool::new(
                "bmm_list_plugins",
                "List installed BMM plugins (id, name, version, permissions, target game).",
                std::sync::Arc::new(serde_json::from_value(json!({ "type": "object", "properties": {} })).unwrap()),
            ),
            Tool::new(
                "bmm_get_api_info",
                "Get the local Plugin API connection info (base URL, port, and token). Set reveal=true to return the full token instead of a masked preview.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "reveal": { "type": "boolean", "description": "Return the full API token (default false → masked)" } }
                })).unwrap()),
            ),
            // ── App Catalog ────────────────────────────────────────────
            Tool::new(
                "bmm_list_apps",
                "List the App Catalog state: installed companion apps, favourites, and community catalog sources.",
                std::sync::Arc::new(serde_json::from_value(json!({ "type": "object", "properties": {} })).unwrap()),
            ),

            // ── Modpacks ───────────────────────────────────────────────
            Tool::new(
                "bmm_list_modpacks",
                "List the user's modpacks (name, mods, share settings).",
                std::sync::Arc::new(serde_json::from_value(json!({ "type": "object", "properties": {} })).unwrap()),
            ),
            Tool::new(
                "bmm_create_modpack",
                "Create a modpack from a list of mod ids.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "Name of the modpack, shown in BMM." },
                        "mod_ids": { "type": "array", "items": { "type": "string" }, "description": "The mods the modpack contains, by id (from bmm_list_mods)." }
                    },
                    "required": ["name", "mod_ids"]
                })).unwrap()),
            ),

            // ── Mods (extra) ───────────────────────────────────────────
            Tool::new(
                "bmm_delete_mod",
                "Delete a mod from BMM. Set delete_files=true to also remove its folder from disk (irreversible).",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": {
                        "mod_id": { "type": "string", "description": "The mod's id, as returned by bmm_list_mods. This deletes its files." },
                        "delete_files": { "type": "boolean", "description": "Also delete the mod folder on disk (default false)" }
                    },
                    "required": ["mod_id"]
                })).unwrap()),
            ),
            Tool::new(
                "bmm_verify_mod_integrity",
                "Verify a mod's on-disk files against its stored SHA-256 hashes. Returns per-file ok/corrupted.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "mod_id": { "type": "string", "description": "The mod's id, as returned by bmm_list_mods. Re-hashes its files and reports what changed." } },
                    "required": ["mod_id"]
                })).unwrap()),
            ),
            Tool::new(
                "bmm_list_tags",
                "List the user's custom mod tags.",
                std::sync::Arc::new(serde_json::from_value(json!({ "type": "object", "properties": {} })).unwrap()),
            ),

            // ── Server-Repos & Themes ──────────────────────────────────
            Tool::new(
                "bmm_list_connected_repos",
                "List the Server-Repos this BMM is connected to (name, url, sync state).",
                std::sync::Arc::new(serde_json::from_value(json!({ "type": "object", "properties": {} })).unwrap()),
            ),
            Tool::new(
                "bmm_list_themes",
                "List installed UI themes and which one is active.",
                std::sync::Arc::new(serde_json::from_value(json!({ "type": "object", "properties": {} })).unwrap()),
            ),
            Tool::new(
                "bmm_get_plugin",
                "Get one installed plugin's full record (manifest, permissions, state) by id.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "plugin_id": { "type": "string", "description": "The plugin's id, as returned by bmm_list_plugins." } },
                    "required": ["plugin_id"]
                })).unwrap()),
            ),

            // ── Session recorder / Privacy & telemetry (live app) ──────
            Tool::new(
                "bmm_recorder_set",
                "Configure the local Session recorder in the running BMM app. All fields optional: on (master switch), full (full-session capture), rust (Rust-side traces), js (frontend traces).",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": {
                        "on": { "type": "boolean", "description": "Turn the session recorder on or off." }, "full": { "type": "boolean", "description": "true records everything, false masks text in the recording." },
                        "rust": { "type": "boolean", "description": "Also record the backend's log lines." }, "js": { "type": "boolean", "description": "Also record the frontend's console." }
                    }
                })).unwrap()),
            ),
            Tool::new(
                "bmm_telemetry_consent",
                "Enable/disable the anonymous-usage telemetry consent in the running BMM app (GDPR opt-in).",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "enabled": { "type": "boolean", "description": "true opts in to telemetry, false opts out. This is the consent itself, not a setting behind it." } },
                    "required": ["enabled"]
                })).unwrap()),
            ),
            Tool::new(
                "bmm_telemetry_settings",
                "Set Privacy & telemetry sub-options in the running BMM app. Omitted fields stay unchanged: replay (session replays), full (full capture), bench (benchmark sharing).",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": {
                        "replay": { "type": "boolean", "description": "Include session replays." }, "full": { "type": "boolean", "description": "Send full payloads rather than counts only." }, "bench": { "type": "boolean", "description": "Include benchmark results." }
                    }
                })).unwrap()),
            ),

            // ── Scheduling & automation ────────────────────────────────
            Tool::new(
                "bmm_list_schedules",
                "List the saved Scheduling & automation tasks (works offline).",
                std::sync::Arc::new(serde_json::from_value(json!({ "type": "object", "properties": {} })).unwrap()),
            ),
            Tool::new(
                "bmm_run_schedule",
                "Trigger a saved scheduler task by id in the running BMM app.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "id": { "type": "string", "description": "The scheduled task's id, as returned by bmm_list_schedules. Runs it once, now, whether or not it is armed." } },
                    "required": ["id"]
                })).unwrap()),
            ),

            // ── Benchmark ──────────────────────────────────────────────
            Tool::new(
                "bmm_run_benchmark",
                "Launch a BMM benchmark in the running app. dataset: 'sandbox' (generated) or 'real' (my mods). size: S|M|L|XL|CUSTOM (mb required for CUSTOM). sources: custom mod-folder paths (dataset=real). profiles: profile ids/names whose mods folders are added. mode: 'manual' (opens pre-filled UI) or 'auto' (runs now, returns results).",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": {
                        "dataset": { "type": "string", "enum": ["sandbox", "real"], "description": "`sandbox` generates throwaway files; `real` measures against the mods actually installed. Use sandbox unless the question is about this machine's own library." },
                        "size": { "type": "string", "enum": ["S", "M", "L", "XL", "CUSTOM"], "description": "How much data to move. XL takes minutes and writes several GB; CUSTOM reads `mb`." },
                        "mb": { "type": "integer", "description": "Dataset size in MB when size=CUSTOM" },
                        "sources": { "type": "array", "items": { "type": "string" }, "description": "Custom mod folder paths (dataset=real)" },
                        "profiles": { "type": "array", "items": { "type": "string" }, "description": "Profile ids/names to benchmark (dataset=real)" },
                        "mode": { "type": "string", "enum": ["manual", "auto"], "description": "`auto` picks the dataset size from what this machine can take; `manual` uses the `size` given here." }
                    }
                })).unwrap()),
            ),

            // ── Sessions (recorder output) ─────────────────────────────
            Tool::new(
                "bmm_list_sessions",
                "List recorded session reports (the Session recorder's output zips).",
                std::sync::Arc::new(serde_json::from_value(json!({ "type": "object", "properties": {} })).unwrap()),
            ),

            // ── Translation sandbox ────────────────────────────────────
            Tool::new(
                "bmm_get_language_template",
                "Download the translation template JSON from the running BMM app (translate it, then import with bmm_import_language).",
                std::sync::Arc::new(serde_json::from_value(json!({ "type": "object", "properties": {} })).unwrap()),
            ),
            Tool::new(
                "bmm_import_language",
                "Import a translated language .json file into the running BMM app.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "path": { "type": "string", "description": "Path to the translated .json file" } },
                    "required": ["path"]
                })).unwrap()),
            ),

            // ── Themes & appearance ────────────────────────────────────
            Tool::new(
                "bmm_apply_theme",
                "Set the active BMM theme by id (e.g. bmm-discord, bmm-void, or an installed custom theme). Applies when BMM reloads themes.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "theme_id": { "type": "string", "description": "The theme's id, as returned by bmm_list_themes." } },
                    "required": ["theme_id"]
                })).unwrap()),
            ),
            Tool::new(
                "bmm_get_theme",
                "Read an INSTALLED custom theme's full definition (vars, element overrides).",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "theme_id": { "type": "string", "description": "The theme's id, as returned by bmm_list_themes." } },
                    "required": ["theme_id"]
                })).unwrap()),
            ),

            // ── Live app bridge ────────────────────────────────────────
            Tool::new(
                "bmm_api_call",
                "Call the RUNNING BMM app's local API (requires the BMM app to be open). Covers every live feature: GET /api/status, /api/repo/list, GET /api/repo/info?url=&password= (password optional, for a password-protected repo), POST /api/repo/sync {url, …, password?}, /api/repo/connect {url}, /api/modpacks/enable {id}, /api/mods/enable {mod_id}, /api/mod/check-updates, /api/apps/launch {id}, /api/schedule/run, … For a password-protected self-hosted repo, pass \"password\" in the sync body or as the info query param. Only GET/POST to 127.0.0.1/api/* is possible.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": {
                        "method": { "type": "string", "enum": ["GET", "POST"], "description": "GET reads, POST acts. Only these two: the bridge does not carry PUT or DELETE." },
                        "path": { "type": "string", "description": "API path starting with /api/ (query string allowed)" },
                        "body": { "type": "object", "description": "JSON body for POST requests" }
                    },
                    "required": ["method", "path"]
                })).unwrap()),
            ),
        ];

        std::future::ready(Ok(ListToolsResult {
            tools,
            next_cursor: None,
            meta: None,
        }))
    }

    fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<CallToolResult, rmcp::ErrorData>> + Send + '_ {
        let name = request.name.clone();
        let args = request.arguments.unwrap_or_default();

        async move {
            match name.as_ref() {
                // Profiles
                "bmm_list_profiles" => self.tool_list_profiles(),
                "bmm_get_active_profile" => self.tool_get_active_profile(),
                "bmm_get_profile" => {
                    let id = args.get("profile_id").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing profile_id", None))?;
                    self.tool_get_profile(id)
                }
                "bmm_set_active_profile" => {
                    let id = args.get("profile_id").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing profile_id", None))?;
                    self.tool_set_active_profile(id)
                }

        // Mods
        "bmm_list_mods" => {
            let pid = args.get("profile_id").and_then(|v| v.as_str());
            let filter = args.get("filter").and_then(|v| v.as_str());
            self.tool_list_mods(pid, filter)
        }
        "bmm_get_mod" => {
            let id = args.get("mod_id").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing mod_id", None))?;
            self.tool_get_mod(id)
        }
        "bmm_search_mods" => {
            let q = args.get("query").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing query", None))?;
            self.tool_search_mods(q)
        }
        "bmm_search" => {
            let q = args.get("query").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing query", None))?;
            let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(20) as usize;
            self.tool_search(q, limit)
        }
        "bmm_set_mod_enabled" => {
            let id = args.get("mod_id").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing mod_id", None))?;
            let enabled = args.get("enabled").and_then(|v| v.as_bool()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing enabled", None))?;
            self.tool_set_mod_enabled(id, enabled)
        }
        "bmm_sync" => self.tool_sync_active_profile(),
        "bmm_generate_repo" => {
            let name = args.get("name").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing name", None))?;
            let ids = args.get("mod_ids").and_then(|v| v.as_array()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing mod_ids", None))?;
            let ids_vec: Vec<String> = ids.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect();
            match mods::generate_repo(name, ids_vec) {
                Ok(msg) => Ok(CallToolResult::success(vec![Content::text(msg)])),
                Err(e) => err_result(&e),
            }
        }
        "bmm_plugin_assets" => {
            let id = args.get("plugin_id").and_then(|v| v.as_str())
                .ok_or_else(|| rmcp::ErrorData::invalid_params("Missing plugin_id", None))?;
            match state_bridge::plugin_assets(id) {
                Ok(v) => ok_json(&v),
                Err(e) => err_result(&e.to_string()),
            }
        }
        "bmm_read_plugin_asset" => {
            let id = args.get("plugin_id").and_then(|v| v.as_str())
                .ok_or_else(|| rmcp::ErrorData::invalid_params("Missing plugin_id", None))?;
            let path = args.get("path").and_then(|v| v.as_str())
                .ok_or_else(|| rmcp::ErrorData::invalid_params("Missing path", None))?;
            match state_bridge::plugin_asset(id, path) {
                Ok(v) => ok_json(&v),
                Err(e) => err_result(&e.to_string()),
            }
        }
        "bmm_set_schedule_enabled" => {
            let mut body = serde_json::Map::new();
            for k in ["id", "enabled"] {
                if let Some(v) = args.get(k) { body.insert(k.into(), v.clone()); }
            }
            self.tool_api_call("POST", "/api/schedules/enabled", Some(serde_json::Value::Object(body))).await
        }
        "bmm_signal" => {
            let mut body = serde_json::Map::new();
            for k in ["name", "data"] {
                if let Some(v) = args.get(k) { body.insert(k.into(), v.clone()); }
            }
            self.tool_api_call("POST", "/api/hook", Some(serde_json::Value::Object(body))).await
        }
        "bmm_signals_seen" => {
            // No name → the summary route, which takes no query at all. The docs said it took
            // a `name` for a long time and it never did; that read now exists one path down,
            // and this is the tool that reaches it.
            let path = match args.get("name").and_then(|v| v.as_str()).map(str::trim).filter(|n| !n.is_empty()) {
                None => "/api/hook".to_string(),
                Some(name) => {
                    // Narrowed HERE, with the writer's own function, rather than passed through
                    // and encoded. A caller who rang "deploy/staging" saw it filed as
                    // "deploy_staging"; asking for the name they typed used to answer `count: 0`
                    // under "deploy_2Fstaging", which is a name that has never existed anywhere.
                    //
                    // The result is alphanumerics, `-`, `_` and `.`, so it needs no escaping to
                    // be a path segment — the narrowing IS the escaping.
                    let key = crate::commands::hooks::safe_hook_name(name);
                    if key.is_empty() { "/api/hook".to_string() }
                    else {
                        match args.get("since").and_then(|v| v.as_i64()) {
                            Some(ms) => format!("/api/hook/{key}?since={ms}"),
                            None => format!("/api/hook/{key}"),
                        }
                    }
                }
            };
            self.tool_api_call("GET", &path, None).await
        }
        "bmm_list_catalogs" => self.tool_api_call("GET", "/api/catalogs", None).await,
        "bmm_follow_catalog" => {
            let mut body = serde_json::Map::new();
            for k in ["type", "url", "follow"] {
                if let Some(v) = args.get(k) { body.insert(k.into(), v.clone()); }
            }
            self.tool_api_call("POST", "/api/catalogs", Some(serde_json::Value::Object(body))).await
        }
        "bmm_repo_extras" => {
            // Percent-encoding for a query value, rather than a dependency for two call
            // sites. A repo URL carries :// and ?, all three of which end the value early
            // and turn "read this repo" into "read some other one".
            fn enc(s: &str) -> String {
                s.bytes().map(|b| match b {
                    b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
                    _ => format!("%{:02X}", b),
                }).collect()
            }
            let url = args.get("url").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing url", None))?;
            let mut q = format!("/api/repo/info?url={}", enc(url));
            if let Some(pw) = args.get("password").and_then(|v| v.as_str()) {
                q.push_str(&format!("&password={}", enc(pw)));
            }
            // Through the live app's own API rather than a second fetcher, so the headers,
            // the password handling and the fallbacks are the ones the app itself uses.
            match state_bridge::api_call("GET", &q, None).await {
                Ok(v) => ok_json(&json!({ "extras": v.get("extras").cloned().unwrap_or(json!([])) })),
                Err(e) => err_result(&e.to_string()),
            }
        }
        "bmm_repo_extra_take" => {
            let mut body = serde_json::Map::new();
            for k in ["url", "kind", "id", "password"] {
                if let Some(v) = args.get(k) { body.insert(k.into(), v.clone()); }
            }
            self.tool_api_call("POST", "/api/repo/extras", Some(serde_json::Value::Object(body))).await
        }
        "bmm_list_keys" => self.tool_api_call("GET", "/api/keys", None).await,
        "bmm_create_key" => {
            let mut body = serde_json::Map::new();
            for k in ["name", "kind"] {
                if let Some(v) = args.get(k) { body.insert(k.into(), v.clone()); }
            }
            self.tool_api_call("POST", "/api/keys", Some(serde_json::Value::Object(body))).await
        }
        "bmm_start_repo_server" => {
            let path = args.get("path").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing path", None))?;
            let port = args.get("port").and_then(|v| v.as_u64()).map(|n| n as u16).unwrap_or(8000);
            match mods::start_repo_server(path, port) {
                Ok(msg) => Ok(CallToolResult::success(vec![Content::text(msg)])),
                Err(e) => err_result(&e),
            }
        }
        "bmm_generate_lightweight_server" => {
            let repo_path = args.get("repo_path").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing repo_path", None))?;
            let port = args.get("port").and_then(|v| v.as_u64()).map(|n| n as u16).unwrap_or(8000);
            let auto_start = args.get("auto_start").and_then(|v| v.as_bool()).unwrap_or(false);
            let use_cloudflare = args.get("use_cloudflare").and_then(|v| v.as_bool()).unwrap_or(false);
            let use_upnp = args.get("use_upnp").and_then(|v| v.as_bool()).unwrap_or(false);
            let upload_limit = args.get("upload_limit").and_then(|v| v.as_u64()).map(|n| n as u32).unwrap_or(0);
            let server_version = args.get("server_version").and_then(|v| v.as_u64()).map(|n| n as u8).unwrap_or(2);
            let admin_password = args.get("admin_password").and_then(|v| v.as_str()).unwrap_or("admin");
            let enable_docker = args.get("enable_docker").and_then(|v| v.as_bool()).unwrap_or(false);
            let docker_host_type = args.get("docker_host_type").and_then(|v| v.as_str()).unwrap_or("linux");
            let server_type = args.get("server_type").and_then(|v| v.as_str()).unwrap_or("user");

            let (final_cloudflare, final_upnp, final_auto_start) = if server_type == "server" {
                (false, false, false)
            } else {
                (use_cloudflare, use_upnp, auto_start)
            };

            match mods::generate_lightweight_server(
                repo_path, port, final_auto_start, final_cloudflare, final_upnp, upload_limit, server_version, admin_password, enable_docker, docker_host_type, server_type
            ) {
                Ok(msg) => Ok(CallToolResult::success(vec![Content::text(msg)])),
                Err(e) => err_result(&e),
            }
        }

                // Documentation & Lang
                "bmm_get_documentation_list" => self.tool_get_documentation_list(),
                "bmm_read_documentation" => {
                    let f = args.get("file_name").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing file_name", None))?;
                    self.tool_read_documentation(f)
                }
                "bmm_get_language_list" => self.tool_get_language_list(),
                "bmm_read_language_file" => {
                    let l = args.get("lang_code").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing lang_code", None))?;
                    self.tool_read_language_file(l)
                }

                // Diagnostics
                "bmm_get_statistics" => self.tool_get_statistics(),
                "bmm_list_crash_reports" => {
                    let limit = args.get("limit").and_then(|v| v.as_u64()).map(|n| n as usize);
                    self.tool_list_crash_reports(limit)
                }
                "bmm_analyze_crash_report" => {
                    let p = args.get("report_path").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing report_path", None))?;
                    self.tool_analyze_crash_report(p)
                }
                "bmm_read_crash_report" => {
                    let p = args.get("report_path").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing report_path", None))?;
                    self.tool_read_crash_report(p)
                }
                "bmm_generate_betahub_report" => {
                    let t = args.get("title").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing title", None))?;
                    let d = args.get("description").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing description", None))?;
                    self.tool_generate_betahub_report(t, d)
                }
                "bmm_export_config" => {
                    let p = args.get("target_path").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing target_path", None))?;
                    self.tool_export_config(p)
                }

                // Launch Packs
                "bmm_list_launch_packs" => self.tool_list_launch_packs(),
                "bmm_create_launch_pack" => {
                    let name = args.get("name").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing name", None))?;
                    let exes = args.get("executable_paths").and_then(|v| v.as_array()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing executable_paths", None))?;
                    let exes_vec: Vec<String> = exes.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect();
                    let icon = args.get("icon_source_path").and_then(|v| v.as_str());
                    self.tool_create_launch_pack(name, exes_vec, icon)
                }
                "bmm_run_launch_pack" => {
                    let id = args.get("id").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing id", None))?;
                    self.tool_run_launch_pack(id)
                }
                "bmm_delete_launch_pack" => {
                    let id = args.get("id").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing id", None))?;
                    self.tool_delete_launch_pack(id)
                }
                "bmm_open_launch_pack_folder" => {
                    let id = args.get("id").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing id", None))?;
                    self.tool_open_launch_pack_folder(id)
                }

                // Plugins & API
                "bmm_list_plugins" => self.tool_list_plugins(),
                "bmm_get_api_info" => {
                    let reveal = args.get("reveal").and_then(|v| v.as_bool()).unwrap_or(false);
                    self.tool_get_api_info(reveal)
                }

                // App Catalog
                "bmm_list_apps" => self.tool_list_apps(),

                // Modpacks
                "bmm_list_modpacks" => self.tool_list_modpacks(),
                "bmm_create_modpack" => {
                    let name = args.get("name").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing name", None))?;
                    let mod_ids: Vec<String> = args.get("mod_ids").and_then(|v| v.as_array())
                        .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                        .unwrap_or_default();
                    self.tool_create_modpack(name, mod_ids)
                }

                // Mods (extra)
                "bmm_delete_mod" => {
                    let id = args.get("mod_id").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing mod_id", None))?;
                    let files = args.get("delete_files").and_then(|v| v.as_bool()).unwrap_or(false);
                    self.tool_delete_mod(id, files)
                }
                "bmm_verify_mod_integrity" => {
                    let id = args.get("mod_id").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing mod_id", None))?;
                    self.tool_verify_mod_integrity(id)
                }
                "bmm_list_tags" => self.tool_list_tags(),

                // Server-Repos & Themes
                "bmm_list_connected_repos" => self.tool_list_connected_repos(),
                "bmm_list_themes" => self.tool_list_themes(),
                "bmm_get_plugin" => {
                    let id = args.get("plugin_id").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing plugin_id", None))?;
                    self.tool_get_plugin(id)
                }

                // Session recorder / Privacy & telemetry (live app)
                "bmm_recorder_set" => {
                    let mut body = serde_json::Map::new();
                    for k in ["on", "full", "rust", "js"] { if let Some(v) = args.get(k).and_then(|v| v.as_bool()) { body.insert(k.into(), v.into()); } }
                    self.tool_api_call("POST", "/api/recorder", Some(serde_json::Value::Object(body))).await
                }
                "bmm_telemetry_consent" => {
                    let enabled = args.get("enabled").and_then(|v| v.as_bool()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing enabled", None))?;
                    self.tool_api_call("POST", "/api/telemetry/consent", Some(json!({ "enabled": enabled }))).await
                }
                "bmm_telemetry_settings" => {
                    let mut body = serde_json::Map::new();
                    for k in ["replay", "full", "bench"] { if let Some(v) = args.get(k).and_then(|v| v.as_bool()) { body.insert(k.into(), v.into()); } }
                    self.tool_api_call("POST", "/api/telemetry/settings", Some(serde_json::Value::Object(body))).await
                }

                // Scheduling & automation
                "bmm_list_schedules" => self.tool_list_schedules(),
                "bmm_bmms_reference" => {
                    // Compiled in rather than read from disk: the generator writes this file
                    // and a gate keeps it in step with the action table, so baking it into the
                    // binary makes "the vocabulary is missing" unrepresentable — and this
                    // server is routinely run with no BMM install beside it.
                    match serde_json::from_str::<serde_json::Value>(BMMS_VOCABULARY) {
                        Ok(v) => ok_json(&v),
                        Err(e) => err_result(&format!(
                            "the bundled BMMScript vocabulary is not valid JSON: {e}"
                        )),
                    }
                }
                "bmm_compile_bmms" => {
                    let src = match args.get("source").and_then(|v| v.as_str()) {
                        Some(x) => x.to_string(),
                        None => return err_result("`source` is required"),
                    };
                    ok_json(&crate::commands::bmms::bmms_compile(src))
                }
                "bmm_decompile_bmms" => {
                    let task = args.get("task").cloned().unwrap_or(serde_json::Value::Null);
                    if !task.is_object() {
                        return err_result("`task` must be a JSON object");
                    }
                    ok_json(&serde_json::Value::String(
                        crate::commands::bmms::bmms_decompile(task),
                    ))
                }
                "bmm_create_schedule" => {
                    let task = args.get("task").cloned().unwrap_or(serde_json::Value::Null);
                    if !task.is_object() { return err_result("`task` must be a JSON object"); }
                    self.tool_create_schedule(task)
                }
                "bmm_delete_schedule" => {
                    let id = match args.get("id").and_then(|v| v.as_str()) { Some(i) => i, None => return err_result("`id` is required") };
                    self.tool_delete_schedule(id)
                }
                "bmm_create_plugin_scaffold" => {
                    let manifest = args.get("manifest").cloned().unwrap_or(serde_json::Value::Null);
                    if !manifest.is_object() { return err_result("`manifest` must be a JSON object"); }
                    let scripts: Vec<(String, String)> = args.get("scripts")
                        .and_then(|v| v.as_array())
                        .map(|arr| arr.iter().filter_map(|it| Some((
                            it.get("name")?.as_str()?.to_string(),
                            it.get("content")?.as_str()?.to_string(),
                        ))).collect())
                        .unwrap_or_default();
                    self.tool_create_plugin_scaffold(manifest, scripts)
                }
                "bmm_list_actions" => ok_json(&state_bridge::list_schedule_actions()),
                "bmm_run_schedule" => {
                    let id = args.get("id").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing id", None))?;
                    self.tool_api_call("POST", "/api/schedule/run", Some(json!({ "id": id }))).await
                }

                // Benchmark
                "bmm_run_benchmark" => {
                    let mut body = serde_json::Map::new();
                    for k in ["dataset", "size", "mode"] { if let Some(v) = args.get(k).and_then(|v| v.as_str()) { body.insert(k.into(), v.into()); } }
                    if let Some(mb) = args.get("mb").and_then(|v| v.as_u64()) { body.insert("mb".into(), mb.into()); }
                    for k in ["sources", "profiles"] { if let Some(v) = args.get(k).and_then(|v| v.as_array()) { body.insert(k.into(), serde_json::Value::Array(v.clone())); } }
                    self.tool_api_call("POST", "/api/benchmark", Some(serde_json::Value::Object(body))).await
                }

                // Sessions
                "bmm_list_sessions" => self.tool_list_sessions(),

                // Translation sandbox
                "bmm_get_language_template" => self.tool_api_call("GET", "/api/language/template", None).await,
                "bmm_import_language" => {
                    let path = args.get("path").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing path", None))?;
                    self.tool_api_call("POST", "/api/language/import", Some(json!({ "path": path }))).await
                }

                // Themes & appearance
                "bmm_apply_theme" => {
                    let id = args.get("theme_id").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing theme_id", None))?;
                    self.tool_apply_theme(id)
                }
                "bmm_get_theme" => {
                    let id = args.get("theme_id").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing theme_id", None))?;
                    self.tool_get_theme(id)
                }

                // Live app bridge
                "bmm_api_call" => {
                    let method = args.get("method").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing method", None))?;
                    let path = args.get("path").and_then(|v| v.as_str()).ok_or_else(|| rmcp::ErrorData::invalid_params("Missing path", None))?;
                    let body = args.get("body").cloned();
                    self.tool_api_call(method, path, body).await
                }

                _ => Err(rmcp::ErrorData::new(ErrorCode::METHOD_NOT_FOUND, format!("Tool not found: {}", name), None)),
            }
        }
    }
}
