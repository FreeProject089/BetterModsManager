use rmcp::{ServerHandler, model::*, service::RequestContext, RoleServer};
use serde_json::json;

use crate::mcp::tools::{profiles, mods, diagnostics, launch_packs};

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
}

// ── MCP ServerHandler Implementation ─────────────────────────────────────

impl ServerHandler for BmmMcpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            protocol_version: ProtocolVersion::V_2024_11_05,
            capabilities: ServerCapabilities::builder()
                .enable_tools()
                .build(),
            server_info: Implementation {
                name: "bmm-mcp-server".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
                title: Some("Better Mods Manager MCP Server".to_string()),
                description: Some("Provides full access to BMM's data and lifecycle for AI agents.".to_string()),
                icons: None,
                website_url: Some("https://github.com/FreeProject089/BetterModsManager".to_string()),
            },
            instructions: Some(
                "Better Mods Manager (BMM) MCP Server. \
                 Allows AI agents to manage profiles, mods, and analyze crashes. \
                 Now includes support for reading UI translation files (Lang) \
                 and documentation (.md)."
                    .to_string(),
            ),
        }
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
                "List all BMM profiles.",
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
                    "properties": { "profile_id": { "type": "string" } },
                    "required": ["profile_id"]
                })).unwrap()),
            ),
            Tool::new(
                "bmm_set_active_profile",
                "Activate a specific profile.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "profile_id": { "type": "string" } },
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
                        "profile_id": { "type": "string" },
                        "filter": { "type": "string", "enum": ["all", "enabled", "disabled"] }
                    }
                })).unwrap()),
            ),
            Tool::new(
                "bmm_get_mod",
                "Get details of a specific mod.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "mod_id": { "type": "string" } },
                    "required": ["mod_id"]
                })).unwrap()),
            ),
            Tool::new(
                "bmm_search_mods",
                "Search mods.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "query": { "type": "string" } },
                    "required": ["query"]
                })).unwrap()),
            ),
            Tool::new(
                "bmm_set_mod_enabled",
                "Enable or disable a mod.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": {
                        "mod_id": { "type": "string" },
                        "enabled": { "type": "boolean" }
                    },
                    "required": ["mod_id", "enabled"]
                })).unwrap()),
            ),
            Tool::new(
                "bmm_sync",
                "Synchronize files for the active profile (apply mods).",
                std::sync::Arc::new(serde_json::from_value(json!({ "type": "object", "properties": {} })).unwrap()),
            ),

            Tool::new(
        "bmm_generate_repo",
        "Generate a repository from a list of mods.",
        std::sync::Arc::new(serde_json::from_value(json!({
            "type": "object",
            "properties": {
                "name": { "type": "string" },
                "mod_ids": { "type": "array", "items": { "type": "string" } }
            },
            "required": ["name", "mod_ids"]
        })).unwrap()),
    ),
    Tool::new(
        "bmm_start_repo_server",
        "Start the repository server.",
        std::sync::Arc::new(serde_json::from_value(json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "port": { "type": "integer" }
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
                    "properties": { "file_name": { "type": "string" } },
                    "required": ["file_name"]
                })).unwrap()),
            ),
            Tool::new(
                "bmm_get_language_list",
                "List available UI languages.",
                std::sync::Arc::new(serde_json::from_value(json!({ "type": "object", "properties": {} })).unwrap()),
            ),
            Tool::new(
                "bmm_read_language_file",
                "Read a language file (UI text/FAQs).",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "lang_code": { "type": "string" } },
                    "required": ["lang_code"]
                })).unwrap()),
            ),
            Tool::new(
                "bmm_generate_lightweight_server",
                "Generate a standalone lightweight server script (.bat) for a given repo.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": {
                        "repo_path": { "type": "string" },
                        "port": { "type": "integer" },
                        "auto_start": { "type": "boolean" },
                        "use_cloudflare": { "type": "boolean" },
                        "use_upnp": { "type": "boolean" },
                        "upload_limit": { "type": "integer" },
                        "server_version": { "type": "integer" },
                        "admin_password": { "type": "string" },
                        "enable_docker": { "type": "boolean" },
                        "docker_host_type": { "type": "string" }
                    },
                    "required": ["repo_path", "port", "auto_start", "use_cloudflare", "use_upnp", "upload_limit", "server_version", "admin_password"]
                })).unwrap()),
            ),

            // Diagnostics
            Tool::new(
                "bmm_get_statistics",
                "Get global statistics.",
                std::sync::Arc::new(serde_json::from_value(json!({ "type": "object", "properties": {} })).unwrap()),
            ),
            Tool::new(
                "bmm_list_crash_reports",
                "List crash reports.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "limit": { "type": "integer" } }
                })).unwrap()),
            ),
            Tool::new(
                "bmm_analyze_crash_report",
                "Analyze a crash report.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "report_path": { "type": "string" } },
                    "required": ["report_path"]
                })).unwrap()),
            ),
            Tool::new(
                "bmm_read_crash_report",
                "Read raw content of a crash report.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "report_path": { "type": "string" } },
                    "required": ["report_path"]
                })).unwrap()),
            ),
            Tool::new(
                "bmm_generate_betahub_report",
                "Generate a report for BetaHub.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": {
                        "title": { "type": "string" },
                        "description": { "type": "string" }
                    },
                    "required": ["title", "description"]
                })).unwrap()),
            ),
            Tool::new(
                "bmm_export_config",
                "Export BMM data.json.",
                std::sync::Arc::new(serde_json::from_value(json!({
                    "type": "object",
                    "properties": { "target_path": { "type": "string" } },
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
                "Delete a Launch Pack.",
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

            match mods::generate_lightweight_server(
                repo_path, port, auto_start, use_cloudflare, use_upnp, upload_limit, server_version, admin_password, enable_docker, docker_host_type
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

                _ => Err(rmcp::ErrorData::new(ErrorCode::METHOD_NOT_FOUND, format!("Tool not found: {}", name), None)),
            }
        }
    }
}
