//! BMM CLI & MCP Server — Binary Entry Point
//!
//! Full-featured CLI for Better Mods Manager + MCP server mode.
//!
//! Usage:
//!   bmm-mcp-server                       # Start MCP server (stdin/stdout JSON-RPC)
//!   bmm-mcp-server serve                  # Same as above (explicit)
//!   bmm-mcp-server profiles               # List all profiles
//!   bmm-mcp-server mods                   # List mods in active profile
//!   bmm-mcp-server mods --profile <id>    # List mods in specific profile
//!   bmm-mcp-server mod <id>               # Show mod details
//!   bmm-mcp-server search <query>         # Search mods
//!   bmm-mcp-server enable <mod_id>        # Enable a mod
//!   bmm-mcp-server disable <mod_id>       # Disable a mod
//!   bmm-mcp-server sync                   # Sync active profile
//!   bmm-mcp-server stats                  # Show global statistics
//!   bmm-mcp-server crashes                # List recent crash reports
//!   bmm-mcp-server crash <path>           # Analyze a crash report
//!   bmm-mcp-server generate-repo ...      # Generate a mod repository
//!   bmm-mcp-server start-server ...       # Start repo HTTP server
//!   bmm-mcp-server generate-lightweight   # Generate standalone .bat server
//!   bmm-mcp-server export-config <path>   # Export data.json
//!   bmm-mcp-server info                   # Show BMM environment info
//!   bmm-mcp-server api [--reveal]         # Show Plugin API URL/port/token
//!   bmm-mcp-server bmms-reference         # Every action/condition/keyword BMMScript knows
//!   bmm-mcp-server bmms-compile --file t.bmms   # BMMScript -> task JSON (+ diagnostics)
//!   bmm-mcp-server bmms-decompile --file t.json # task JSON -> BMMScript

#[path = "../mcp/mod.rs"]
mod mcp;

// The mcp tools spawn children via `crate::commands::proc` (no-console helpers).
// This example is self-contained, so mount the same file at the same crate path.
mod commands {
    #[path = "../../commands/proc.rs"]
    pub mod proc;
    // Reading a plugin's shipped files, and the path guard that keeps a `..` from leaving
    // the folder. Mounted rather than reimplemented: the CLI reads the same archives the app
    // does, and a second guard is the one that gets forgotten.
    #[path = "../../commands/plugin_assets_core.rs"]
    pub mod plugin_assets_core;
    // The BMMScript compiler. Mounted, not reimplemented — there is one compiler for this
    // language and a second one is the thing it exists to avoid. It pulls in nothing but
    // serde, so the CLI can compile a task with no app, no state and no HTTP.
    #[path = "../../commands/bmms.rs"]
    pub mod bmms;
}

use clap::{Parser, Subcommand};
use colored::Colorize;
use comfy_table::{Table, ContentArrangement, presets::UTF8_FULL_CONDENSED};
use mcp::server::BmmMcpServer;
use mcp::state_bridge;
use mcp::tools::{mods, profiles, diagnostics, launch_packs};

/// Better Mods Manager — CLI & MCP Server
#[derive(Parser)]
#[command(
    name = "bmm",
    version = env!("CARGO_PKG_VERSION"),
    about = "Better Mods Manager CLI — Manage mods, profiles, repos & servers from the terminal.",
    long_about = None,
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

/// Percent-encode a query VALUE.
///
/// A repo URL carries :// and often a ?; all of them end the value early and turn
/// "read this repo" into "read some other one". A dependency for two call sites
/// would be the wrong trade.
fn pct(s: &str) -> String {
    s.bytes().map(|b| match b {
        b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
        _ => format!("%{:02X}", b),
    }).collect()
}

#[derive(Subcommand)]
enum Commands {
    /// Start the MCP server (JSON-RPC over stdio)
    Serve,

    /// Show BMM environment info
    Info,

    // ── Profiles ──────────────────────────────────────────────────────

    /// List all profiles
    Profiles,

    /// Show details of active profile
    ActiveProfile,

    /// Set the active profile
    #[command(name = "set-profile")]
    SetProfile {
        /// Profile ID to activate
        profile_id: String,
    },

    // ── Mods ──────────────────────────────────────────────────────────

    /// List mods (optionally filtered)
    Mods {
        /// Profile ID (defaults to active profile)
        #[arg(short, long)]
        profile: Option<String>,

        /// Filter: all, enabled, disabled
        #[arg(short, long, default_value = "all")]
        filter: String,
    },

    /// Show details of a specific mod
    Mod {
        /// Mod ID
        mod_id: String,
    },

    /// Search mods by name/description
    Search {
        /// Search query
        query: String,
    },

    /// Enable a mod
    Enable {
        /// Mod ID to enable
        mod_id: String,
    },

    /// Disable a mod
    Disable {
        /// Mod ID to disable
        mod_id: String,
    },

    /// Sync files for the active profile (apply mods)
    Sync,

    // ── Repository ────────────────────────────────────────────────────

    /// Generate a mod repository (with authentic crypto signature)
    #[command(name = "generate-repo")]
    GenerateRepo {
        /// Repository name
        #[arg(short, long)]
        name: String,

        /// Mod IDs to include (comma-separated)
        #[arg(short, long, value_delimiter = ',')]
        mod_ids: Vec<String>,
    },

    /// Start the repository HTTP server + Cloudflare tunnel
    #[command(name = "start-server")]
    StartServer {
        /// Path to the repository directory
        #[arg(short = 'd', long)]
        path: String,

        /// Port to serve on
        #[arg(short, long, default_value_t = 8080)]
        port: u16,
    },

    /// Generate a standalone lightweight server script (.bat)
    #[command(name = "generate-lightweight")]
    GenerateLightweight {
        /// Path to the repository directory
        #[arg(short = 'd', long)]
        repo_path: String,

        /// Port
        #[arg(short, long, default_value_t = 8000)]
        port: u16,

        /// Run at Windows startup
        #[arg(long, default_value_t = false)]
        auto_start: bool,

        /// Enable Cloudflare Tunnel
        #[arg(long, default_value_t = false)]
        cloudflare: bool,

        /// Enable UPnP port forwarding
        #[arg(long, default_value_t = false)]
        upnp: bool,

        /// Upload speed limit in KB/s (0 = unlimited)
        #[arg(long, default_value_t = 0)]
        upload_limit: u32,

        /// Server version (1 = hybrid, 2 = Lux v2)
        #[arg(short = 'v', long, default_value_t = 2)]
        server_version: u8,

        /// Admin password
        #[arg(long, default_value = "admin")]
        password: String,
    },

    // ── Diagnostics ───────────────────────────────────────────────────

    /// Show global statistics
    Stats,

    /// List recent crash reports
    Crashes {
        /// Max number of reports to show
        #[arg(short, long, default_value_t = 10)]
        limit: usize,
    },

    /// Analyze a crash report
    Crash {
        /// Path to the crash report file
        report_path: String,
    },

    /// Export BMM data.json to a file
    #[command(name = "export-config")]
    ExportConfig {
        /// Target path
        target_path: String,
    },

    // ── Launch Packs ──────────────────────────────────────────────────
    
    /// List all launch packs
    #[command(name = "launchpacks")]
    LaunchPacks,

    /// Run a specific launch pack
    #[command(name = "run-pack")]
    RunPack {
        /// Pack ID or Name
        id: String,
    },

    /// Delete a specific launch pack
    #[command(name = "delete-pack")]
    DeletePack {
        /// Pack ID or Name
        id: String,
    },

    /// Open the folder of a specific launch pack
    #[command(name = "open-pack")]
    OpenPack {
        /// Pack ID or Name
        id: String,
    },

    // ── Plugin API ────────────────────────────────────────────────────

    /// Show the local Plugin API URL, port & token (for scripts/plugins)
    Api {
        /// Print the full API token instead of a masked preview
        #[arg(long, default_value_t = false)]
        reveal: bool,
    },

    /// List installed plugins (id, name, version, permissions)
    Plugins,

    /// Show one installed plugin's full record (manifest, permissions, state)
    Plugin {
        /// Plugin id
        plugin_id: String,
    },

    /// Show the App Catalog state (installed apps, favourites, community sources)
    Apps,

    /// List modpacks
    Modpacks,

    /// Create a modpack from mod ids (or names)
    CreateModpack {
        /// Modpack name
        name: String,
        /// Mod ids/names to include
        #[arg(required = true)]
        mod_ids: Vec<String>,
    },

    /// List the user's custom mod tags
    Tags,

    /// List the Server-Repos this BMM is connected to
    Repos,

    /// List installed UI themes (and the active one)
    Themes,

    /// Verify a mod's on-disk files against its stored SHA-256 hashes
    VerifyMod {
        /// Mod id
        mod_id: String,
    },

    /// Delete a mod from BMM (--files also removes its folder on disk)
    DeleteMod {
        /// Mod id
        mod_id: String,
        /// Also delete the mod folder on disk (irreversible)
        #[arg(long, default_value_t = false)]
        files: bool,
    },

    // ── What a repo carries besides mods ──────────────────────────

    /// List the files a plugin ships in its assets/ folder
    #[command(name = "plugin-assets")]
    PluginAssets {
        /// Plugin id
        plugin_id: String,
    },

    /// Print one of a plugin's shipped files. Text only; nothing is executed.
    #[command(name = "plugin-asset")]
    PluginAsset {
        /// Plugin id
        plugin_id: String,
        /// Path relative to assets/, e.g. README.md
        path: String,
    },

    /// Arm or disarm one saved task
    #[command(name = "schedule-set")]
    ScheduleSet {
        /// Task id, from `schedules`
        id: String,
        /// Turn it off instead of on
        #[arg(long, default_value_t = false)]
        off: bool,
    },

    /// Ring a doorbell a task may be waiting on (wait.hook)
    Signal {
        /// The signal name
        name: String,
        /// Optional JSON payload for the waiting task
        data: Option<String>,
    },

    /// List the catalogues this BMM follows, by type.
    Catalogs,

    /// Follow a catalogue. `--off` stops following it.
    Follow {
        /// app | plugin | theme | preset | modpack | repo | tutorial | list
        #[arg(long = "type")]
        kind: String,
        /// The catalogue's address
        url: String,
        /// Stop following it instead
        #[arg(long, default_value_t = false)]
        off: bool,
    },

    /// List what a repo carries besides mods: plugins, automations, themes,
    /// mod lists, catalogues to follow. Reads the manifest — downloads nothing.
    #[command(name = "repo-extras")]
    RepoExtras {
        /// Repo URL, with or without /repo.json
        url: String,
        /// Download password, if the repo has one
        #[arg(long)]
        password: Option<String>,
    },

    /// Take ONE thing a repo carries, named by kind and id from `repo-extras`.
    /// A plugin or an automation arrives DISABLED; a catalogue is followed, not
    /// downloaded; a mod list is saved and its path printed.
    #[command(name = "repo-take")]
    RepoTake {
        /// Repo URL
        url: String,
        /// plugin | task | theme | modlist | bundle | catalog | app
        kind: String,
        /// The entry id
        id: String,
        #[arg(long)]
        password: Option<String>,
    },

    // ── Identity keys ────────────────────────────────────

    /// List the identity keys BMM can prove with — names and paths only.
    Keys,

    /// Make an identity keypair. Prints the PUBLIC line and where the private
    /// half was written; the private half itself is never printed.
    #[command(name = "new-key")]
    NewKey {
        /// What to call it on the ring
        name: String,
        /// ed25519 (default) | ecdsa | rsa
        #[arg(long)]
        kind: Option<String>,
    },

    /// Call the RUNNING BMM app's local API (e.g. `call GET /api/status`)
    Call {
        /// HTTP method: GET or POST
        method: String,
        /// API path starting with /api/ (query string allowed)
        path: String,
        /// JSON body for POST requests
        body: Option<String>,
    },

    /// Configure the local Session recorder (running app)
    Recorder {
        /// Master switch: true/false
        #[arg(long)]
        on: Option<bool>,
        /// Full-session capture: true/false
        #[arg(long)]
        full: Option<bool>,
        /// Rust-side traces: true/false
        #[arg(long)]
        rust: Option<bool>,
        /// Frontend traces: true/false
        #[arg(long)]
        js: Option<bool>,
    },

    /// List recorded session reports (Session recorder output)
    Sessions,

    /// Set the anonymous-usage telemetry consent (running app)
    TelemetryConsent {
        /// true = opt in, false = opt out
        enabled: bool,
    },

    /// Set Privacy & telemetry sub-options (running app; omitted = unchanged)
    TelemetrySettings {
        /// Session replays: true/false
        #[arg(long)]
        replay: Option<bool>,
        /// Full capture: true/false
        #[arg(long)]
        full: Option<bool>,
        /// Benchmark sharing: true/false
        #[arg(long)]
        bench: Option<bool>,
    },

    /// List the saved Scheduling & automation tasks
    Schedules,

    /// Trigger a saved scheduler task by id (running app)
    RunSchedule {
        /// Task id
        id: String,
    },

    /// Create or update a scheduler task from a JSON file or inline JSON.
    /// Shape = what the in-app builder saves; created DISABLED unless the JSON
    /// says enabled:true, so it can be inspected before it ever fires.
    CreateSchedule {
        /// Path to a task .json file, or '-' to read stdin
        #[arg(long, conflicts_with = "json")]
        file: Option<String>,
        /// Inline task JSON
        #[arg(long)]
        json: Option<String>,
    },

    /// Delete a scheduler task by id
    DeleteSchedule {
        /// Task id (see `schedules`)
        id: String,
    },

    /// Scaffold a plugin draft (plugin.json + README + bundled scripts) in
    /// <app-data>/plugin-drafts/<id>/. Authoring only — zip the draft and install it
    /// through BMM's normal flow; scripts only run behind the unsafe-plugins permission.
    CreatePlugin {
        /// Path to a plugin.json manifest, or '-' for stdin
        #[arg(long, conflicts_with = "json")]
        file: Option<String>,
        /// Inline manifest JSON
        #[arg(long)]
        json: Option<String>,
        /// Script file(s) to bundle under scripts/ (repeatable). The file NAME is kept;
        /// the manifest's scripts list and has_scripts are derived from what is written.
        #[arg(long = "script")]
        scripts: Vec<String>,
    },

    /// List every action type a scheduler task step may use — the same registry the
    /// in-app builder shows. Use with `create-schedule`: a step is
    /// {kind:'action', action:{type:<one of these>, params:{...}}}.
    Actions,

    /// Print the whole BMMScript vocabulary as JSON: actions and their parameter names,
    /// conditions, value sources, loop sources, keywords, permissions, script engines.
    /// Generated from the same table the in-app builder renders, so it cannot name an
    /// action the runner does not have. Needs no running app.
    BmmsReference,

    /// Compile BMMScript into the task JSON `create-schedule` takes.
    ///
    /// The pairing is the point: writing the JSON by hand means assembling a nested tree
    /// and learning it was wrong when the task runs, while this names the line and column.
    ///   bmm-mcp-server bmms-compile --file nightly.bmms | bmm-mcp-server create-schedule --file -
    /// Exits non-zero, and prints nothing on stdout, when the source does not compile — so
    /// that pipe cannot save a half-parsed task. Needs no running app.
    BmmsCompile {
        /// Path to a .bmms/.bmmscript source file, or '-' to read stdin
        #[arg(long, conflicts_with = "source")]
        file: Option<String>,
        /// Inline BMMScript source
        #[arg(long)]
        source: Option<String>,
    },

    /// Print a saved task back as BMMScript — the inverse of `bmms-compile`, and the way
    /// to edit a task as text rather than as a tree. Needs no running app.
    BmmsDecompile {
        /// Path to a task .json file, or '-' to read stdin
        #[arg(long, conflicts_with = "json")]
        file: Option<String>,
        /// Inline task JSON
        #[arg(long)]
        json: Option<String>,
    },

    /// Launch a benchmark (running app)
    Benchmark {
        /// Dataset: sandbox (generated) or real (my mods)
        #[arg(long, default_value = "sandbox")]
        dataset: String,
        /// Size: S | M | L | XL | CUSTOM
        #[arg(long, default_value = "M")]
        size: String,
        /// Dataset MB (when --size CUSTOM)
        #[arg(long)]
        mb: Option<u64>,
        /// Custom mod-folder path(s) to benchmark (dataset=real, repeatable)
        #[arg(long)]
        source: Vec<String>,
        /// Profile id(s)/name(s) whose mods folders are benchmarked (repeatable)
        #[arg(long)]
        profile: Vec<String>,
        /// Run now in the background and print results (default: opens the UI pre-filled)
        #[arg(long, default_value_t = false)]
        auto: bool,
    },

    /// Download the translation template JSON (running app)
    LangTemplate {
        /// Write to this file instead of stdout
        #[arg(long)]
        out: Option<String>,
    },

    /// Import a translated language .json file (running app)
    ImportLanguage {
        /// Path to the translated .json
        path: String,
    },

    /// Set the active theme by id (applies when BMM reloads themes)
    ThemeApply {
        /// Theme id (e.g. bmm-discord, or an installed custom theme id)
        theme_id: String,
    },

    /// Show an installed custom theme's full definition
    ThemeInfo {
        /// Theme id
        theme_id: String,
    },
}

// ─── Fancy banner ─────────────────────────────────────────────────────────

fn print_banner() {
    let banner = r#"
  ____  __  __ __  __    ____ _     ___
 | __ )|  \/  |  \/  |  / ___| |   |_ _|
 |  _ \| |\/| | |\/| | | |   | |    | |
 | |_) | |  | | |  | | | |___| |___ | |
 |____/|_|  |_|_|  |_|  \____|_____|___|
"#;
    eprintln!("{}", banner.bright_cyan());
    eprintln!("  {} {}", "Better Mods Manager".bold().white(), format!("v{}", env!("CARGO_PKG_VERSION")).dimmed());
    eprintln!("  {}\n", "─".repeat(40).dimmed());
}

// ─── Main ─────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    match cli.command {
        // Default (no subcommand) or explicit `serve` → MCP mode
        None | Some(Commands::Serve) => {
            run_mcp_server().await
        }

        Some(cmd) => {
            // CLI mode — init stderr logging + banner
            tracing_subscriber::fmt()
                .with_writer(std::io::stderr)
                .with_env_filter(
                    tracing_subscriber::EnvFilter::try_from_default_env()
                        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warn"))
                )
                .init();

            print_banner();
            run_cli_command(cmd).await
        }
    }
}

async fn run_mcp_server() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"))
        )
        .init();

    tracing::info!(
        "Starting BMM MCP Server v{} (PID: {})",
        env!("CARGO_PKG_VERSION"),
        std::process::id()
    );

    let data_dir = state_bridge::get_bmm_data_dir();
    let data_path = data_dir.join("data.json");

    if data_path.exists() {
        tracing::info!("Found BMM data at {:?}", data_path);
    } else {
        tracing::warn!(
            "BMM data.json not found at {:?}. Set BMM_DATA_DIR env var to override.",
            data_path
        );
    }

    let server = BmmMcpServer::new();
    tracing::info!("MCP server ready, listening on stdio...");
    let service = rmcp::ServiceExt::serve(server, rmcp::transport::stdio()).await?;
    service.waiting().await?;
    tracing::info!("MCP server shutting down.");
    Ok(())
}


/// Read a JSON argument from a file, from stdin (`-`), or inline.
///
/// Both authoring commands took the same three ways in, and the block was pasted
/// twice - so a fix to one path (the BOM below, a size cap) would have had to be
/// found and repeated. `what` only names the file in the usage hint.
fn read_json_arg(file: Option<String>, json: Option<String>, what: &str) -> anyhow::Result<String> {
    let raw = match (file, json) {
        (Some(f), _) if f == "-" => {
            use std::io::Read;
            let mut b = String::new();
            std::io::stdin().read_to_string(&mut b)?;
            b
        }
        (Some(f), _) => std::fs::read_to_string(&f)?,
        (None, Some(j)) => j,
        (None, None) => anyhow::bail!("provide --file <{}> (or - for stdin) or --json '<inline>'", what),
    };
    // PowerShell redirection writes a BOM, and serde_json rejects it with a
    // confusing "expected value at line 1 column 1".
    Ok(raw.trim_start_matches('﻿').to_string())
}

async fn run_cli_command(cmd: Commands) -> anyhow::Result<()> {
    match cmd {
        Commands::Serve => unreachable!(),

        // ── Info ──────────────────────────────────────────────────────
        Commands::Info => {
            let data_dir = state_bridge::get_bmm_data_dir();
            let data_path = data_dir.join("data.json");
            let key_path = data_dir.join("creator_v2.key");

            println!("  {} {}", "Data Dir:".bold(), data_dir.display());
            println!("  {} {}", "data.json:".bold(),
                if data_path.exists() { "✓ Found".green().to_string() } else { "✗ Missing".red().to_string() });
            println!("  {} {}", "Signing Key:".bold(),
                if key_path.exists() { "✓ Found (creator_v2.key)".green().to_string() } else { "✗ Missing".red().to_string() });

            if let Ok(profs) = profiles::list_profiles() {
                println!("  {} {}", "Profiles:".bold(), profs.len().to_string().cyan());
            }
            if let Ok(all_mods) = mods::list_mods(None, None) {
                println!("  {} {}", "Total Mods:".bold(), all_mods.len().to_string().cyan());
            }
        }

        // ── Plugin API ────────────────────────────────────────────────
        Commands::Api { reveal } => {
            let data = state_bridge::read_app_data()?;
            let port = if data.settings.api_port == 0 { 51274 } else { data.settings.api_port };
            let token = &data.settings.api_token;
            let masked = if token.is_empty() {
                "—".to_string()
            } else if reveal {
                token.clone()
            } else if token.len() > 8 {
                format!("{}…{}", &token[..4], &token[token.len() - 4..])
            } else {
                "••••".to_string()
            };
            println!("  {} http://127.0.0.1:{}", "API URL:".bold(), port.to_string().cyan());
            println!("  {} {}", "Port:".bold(), port.to_string().cyan());
            println!("  {} {}{}", "Token:".bold(), masked.yellow(),
                if reveal || token.is_empty() { "".to_string() } else { "  (use --reveal to show)".dimmed().to_string() });
            println!();
            println!("  {}", "Quick test:".bold());
            println!("    curl http://127.0.0.1:{}/api/health", port);
            println!("    curl -H \"Authorization: Bearer <token>\" http://127.0.0.1:{}/api/mods", port);
            println!();
            println!("  {}", "Note: BMM must be running for the API to respond. The port is configurable in Settings → Identity & API (restart required).".dimmed());
        }

        // ── Plugins ──────────────────────────────────────────────────
        Commands::Plugins => {
            let plugins = state_bridge::list_plugins()?;
            if plugins.is_empty() {
                println!("  {}", "No plugins installed.".dimmed());
            } else {
                let mut table = Table::new();
                table.load_preset(UTF8_FULL_CONDENSED);
                table.set_content_arrangement(ContentArrangement::Dynamic);
                table.set_header(vec!["ID", "Name", "Version", "Permissions"]);
                for p in &plugins {
                    let s = |k: &str| p.get(k).and_then(|v| v.as_str()).unwrap_or("—").to_string();
                    let perms = p.get("permissions").and_then(|v| v.as_array())
                        .map(|a| a.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(", "))
                        .unwrap_or_else(|| "—".to_string());
                    table.add_row(vec![s("id"), s("name"), s("version"), perms]);
                }
                println!("{table}");
                println!("  {} {}", plugins.len().to_string().cyan().bold(), "plugin(s) installed".dimmed());
            }
        }

        // ── App Catalog ──────────────────────────────────────────────
        Commands::Apps => {
            let apps = state_bridge::list_apps()?;
            let installed = apps.get("installed").and_then(|v| v.as_object());
            let favorites = apps.get("favorites").and_then(|v| v.as_array());
            let sources = apps.get("community_sources").and_then(|v| v.as_array());

            println!("  {}", "Installed apps:".bold());
            match installed {
                Some(m) if !m.is_empty() => for (id, _) in m { println!("    • {}", id.cyan()); },
                _ => println!("    {}", "none".dimmed()),
            }
            println!();
            println!("  {} {}", "Favourites:".bold(),
                favorites.map(|a| a.len()).unwrap_or(0).to_string().cyan());
            println!("  {}", "Community catalog sources:".bold());
            match sources {
                Some(a) if !a.is_empty() => for s in a { if let Some(u) = s.as_str() { println!("    • {}", u.dimmed()); } },
                _ => println!("    {}", "none".dimmed()),
            }
        }

        // ── Plugin detail ────────────────────────────────────────────
        Commands::Plugin { plugin_id } => {
            let p = state_bridge::get_plugin(&plugin_id)?;
            println!("{}", serde_json::to_string_pretty(&p)?);
        }

        // ── Modpacks ─────────────────────────────────────────────────
        Commands::Modpacks => {
            let packs = state_bridge::list_modpacks()?;
            if packs.is_empty() {
                println!("  {}", "No modpacks.".dimmed());
            } else {
                let mut table = Table::new();
                table.load_preset(UTF8_FULL_CONDENSED);
                table.set_content_arrangement(ContentArrangement::Dynamic);
                table.set_header(vec!["ID", "Name", "Mods"]);
                for p in &packs {
                    let s = |k: &str| p.get(k).and_then(|v| v.as_str()).unwrap_or("—").to_string();
                    let n = p.get("mod_ids").and_then(|v| v.as_array()).map(|a| a.len())
                        .or_else(|| p.get("mods").and_then(|v| v.as_array()).map(|a| a.len()))
                        .unwrap_or(0);
                    table.add_row(vec![s("id"), s("name"), n.to_string()]);
                }
                println!("{table}");
                println!("  {} {}", packs.len().to_string().cyan().bold(), "modpack(s)".dimmed());
            }
        }
        Commands::CreateModpack { name, mod_ids } => {
            let msg = state_bridge::create_modpack(&name, mod_ids)?;
            println!("  {} {}", "✓".green().bold(), msg);
        }

        // ── Tags ─────────────────────────────────────────────────────
        Commands::Tags => {
            let tags = state_bridge::list_tags()?;
            if tags.is_empty() {
                println!("  {}", "No custom tags.".dimmed());
            } else {
                for t in &tags {
                    println!("  • {} {}", t.name.cyan(), t.color.as_deref().unwrap_or("").dimmed());
                }
                println!("\n  {} {}", tags.len().to_string().cyan().bold(), "tag(s)".dimmed());
            }
        }

        // ── Connected Server-Repos ───────────────────────────────────
        Commands::Repos => {
            let repos = state_bridge::list_connected_repos()?;
            let list = repos.as_array().cloned().unwrap_or_default();
            if list.is_empty() {
                println!("  {}", "No connected Server-Repos.".dimmed());
            } else {
                let mut table = Table::new();
                table.load_preset(UTF8_FULL_CONDENSED);
                table.set_content_arrangement(ContentArrangement::Dynamic);
                table.set_header(vec!["Name", "URL"]);
                for r in &list {
                    let s = |k: &str| r.get(k).and_then(|v| v.as_str()).unwrap_or("—").to_string();
                    table.add_row(vec![s("name"), s("url")]);
                }
                println!("{table}");
                println!("  {} {}", list.len().to_string().cyan().bold(), "connected repo(s)".dimmed());
            }
        }

        // ── Themes ───────────────────────────────────────────────────
        Commands::Themes => {
            let v = state_bridge::list_themes()?;
            let active = v.get("active").and_then(|x| x.as_str()).unwrap_or("(default)");
            println!("  {} {}\n", "Active theme:".bold(), active.cyan());
            let installed = v.get("installed").and_then(|x| x.as_array()).cloned().unwrap_or_default();
            if installed.is_empty() {
                println!("  {}", "No custom themes installed.".dimmed());
            } else {
                for t in &installed {
                    let s = |k: &str| t.get(k).and_then(|x| x.as_str()).unwrap_or("—").to_string();
                    let mark = if t.get("active").and_then(|x| x.as_bool()).unwrap_or(false) { "●" } else { "○" };
                    println!("  {} {} {} {}", mark.cyan(), s("name").bold(), format!("v{}", s("version")).dimmed(), format!("by {}", s("author")).dimmed());
                }
            }
        }

        // ── Mod integrity / deletion ─────────────────────────────────
        Commands::VerifyMod { mod_id } => {
            let map = state_bridge::verify_integrity(&mod_id)?;
            let bad: Vec<&String> = map.iter().filter(|(_, ok)| !**ok).map(|(f, _)| f).collect();
            if map.is_empty() {
                println!("  {}", "No stored hashes for this mod (nothing to verify).".dimmed());
            } else if bad.is_empty() {
                println!("  {} {} {}", "✓".green().bold(), map.len().to_string().cyan(), "file(s) verified — all hashes match".green());
            } else {
                println!("  {} {} corrupted file(s):", "✗".red().bold(), bad.len().to_string().red().bold());
                for f in bad { println!("    • {}", f.red()); }
            }
        }
        Commands::DeleteMod { mod_id, files } => {
            let msg = state_bridge::delete_mod(&mod_id, files)?;
            println!("  {} {}", "✓".green().bold(), msg);
        }

        // ── Live app bridge ──────────────────────────────────────────
        // ── Catalogues ───────────────────────────────────────
        // ── What a plugin ships ──────────────────────────────────
        //
        // Offline, like most of this file: data.json says where the plugin is and the folder
        // says what is in it. That matters more here than elsewhere — the reason to ask what
        // a plugin ships is usually that you are deciding whether to install it, which is not
        // a moment when the app is open on that screen.
        Commands::PluginAssets { plugin_id } => {
            let v = state_bridge::plugin_assets(&plugin_id)?;
            let list = v.get("assets").and_then(|a| a.as_array()).cloned().unwrap_or_default();
            if list.is_empty() {
                println!("  {}", "This plugin ships no extra files.".dimmed());
            } else {
                let mut table = Table::new();
                table.load_preset(UTF8_FULL_CONDENSED);
                table.set_content_arrangement(ContentArrangement::Dynamic);
                table.set_header(vec!["File", "Kind", "Size"]);
                for a in &list {
                    let s = |k: &str| a.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let size = a.get("size").and_then(|v| v.as_u64()).unwrap_or(0);
                    // A shipped script is not a problem and it is also not a README.
                    // Coloured so nobody scanning eleven rows has to read extensions to
                    // notice there is a program in the list.
                    let kind = if s("kind") == "script" {
                        s("kind").yellow().bold().to_string()
                    } else {
                        s("kind")
                    };
                    table.add_row(vec![s("path"), kind, format!("{} KB", std::cmp::max(1, size / 1024))]);
                }
                println!("{table}");
                println!("  {} {}", list.len().to_string().cyan().bold(), "file(s)".dimmed());
            }
        }
        Commands::PluginAsset { plugin_id, path } => {
            let v = state_bridge::plugin_asset(&plugin_id, &path)?;
            // The text on stdout and nothing else, so
            // `bmm plugin-asset x README.md > out.md` is a file rather than a file with a
            // banner in it.
            print!("{}", v.get("text").and_then(|t| t.as_str()).unwrap_or(""));
        }

        Commands::ScheduleSet { id, off } => {
            let body = serde_json::json!({ "id": id, "enabled": !off });
            let res = state_bridge::api_call("POST", "/api/schedules/enabled", Some(body)).await?;
            println!("{}", serde_json::to_string_pretty(res.get("body").unwrap_or(&serde_json::Value::Null))?);
        }
        Commands::Signal { name, data } => {
            let payload = match data {
                // Parsed as JSON when it is JSON, sent as a string when it is not. A caller
                // piping a plain word should not have to quote it into a JSON string.
                Some(d) => serde_json::from_str::<serde_json::Value>(&d)
                    .unwrap_or(serde_json::Value::String(d)),
                None => serde_json::Value::Null,
            };
            let res = state_bridge::api_call("POST", "/api/hook", Some(serde_json::json!({ "name": name, "data": payload }))).await?;
            let b = res.get("body").cloned().unwrap_or(serde_json::Value::Null);
            // The name it was FILED under, which is not always the name given — it is
            // narrowed to something that can be a key.
            if let Some(n) = b.get("name").and_then(|v| v.as_str()) {
                println!("  {} {}", "✓".green().bold(), format!("rang \"{}\"", n).dimmed());
            } else {
                println!("{}", serde_json::to_string_pretty(&b)?);
            }
        }

        Commands::Catalogs => {
            let res = state_bridge::api_call("GET", "/api/catalogs", None).await?;
            let body = res.get("body").cloned().unwrap_or(serde_json::Value::Null);
            let sources = body.get("sources").and_then(|v| v.as_object()).cloned().unwrap_or_default();
            let total: usize = sources.values().map(|v| v.as_array().map_or(0, |a| a.len())).sum();
            if total == 0 {
                // The distinction the mirror exists to make. Without it, an app that has not
                // run since this feature landed is indistinguishable from one that follows
                // nothing — and only one of those is worth investigating.
                if body.get("written_at").and_then(|v| v.as_str()).is_none() {
                    println!("  {}", "BMM has not pushed its catalogue list yet — open the app once.".dimmed());
                } else {
                    println!("  {}", "No catalogues followed.".dimmed());
                }
            } else {
                let mut table = Table::new();
                table.load_preset(UTF8_FULL_CONDENSED);
                table.set_content_arrangement(ContentArrangement::Dynamic);
                table.set_header(vec!["Type", "Catalogue"]);
                for (kind, urls) in &sources {
                    for u in urls.as_array().cloned().unwrap_or_default() {
                        table.add_row(vec![kind.clone(), u.as_str().unwrap_or("").to_string()]);
                    }
                }
                println!("{table}");
                println!("  {} {}", total.to_string().cyan().bold(), "catalogue(s) followed".dimmed());
                if let Some(at) = body.get("written_at").and_then(|v| v.as_str()) {
                    println!("  {} {}", "as of".dimmed(), at.dimmed());
                }
            }
        }
        Commands::Follow { kind, url, off } => {
            let body = serde_json::json!({ "type": kind, "url": url, "follow": !off });
            let res = state_bridge::api_call("POST", "/api/catalogs", Some(body)).await?;
            let status = res.get("status").and_then(|v| v.as_u64()).unwrap_or(0);
            // 202, not 200: the write is driven through the app's own screens, so what came
            // back is "the app was told", not "the list now says this".
            if (200..300).contains(&status) {
                println!("  {} {}", "✓".green().bold(), "Asked BMM to update its catalogue list.".dimmed());
            } else {
                println!("{}", serde_json::to_string_pretty(res.get("body").unwrap_or(&serde_json::Value::Null))?);
            }
        }

        // ── Repo extras ──────────────────────────────────────
        //
        // Through the live app's own API rather than a second fetcher, so the headers, the
        // password handling and the fallbacks are the ones the app itself uses — and so
        // there is one implementation of the hash check, not two.
        Commands::RepoExtras { url, password } => {
            let mut q = format!("/api/repo/info?url={}", pct(&url));
            if let Some(pw) = password.as_deref().filter(|p| !p.is_empty()) {
                q.push_str(&format!("&password={}", pct(pw)));
            }
            let res = state_bridge::api_call("GET", &q, None).await?;
            let extras = res.get("body").and_then(|b| b.get("extras"))
                .and_then(|v| v.as_array()).cloned().unwrap_or_default();
            if extras.is_empty() {
                println!("  {}", "This repo carries nothing besides mods.".dimmed());
            } else {
                let mut table = Table::new();
                table.load_preset(UTF8_FULL_CONDENSED);
                table.set_content_arrangement(ContentArrangement::Dynamic);
                table.set_header(vec!["Kind", "Id", "Name", "Note"]);
                for e in &extras {
                    let s = |k: &str| e.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let mut note = s("version");
                    if e.get("locked").and_then(|v| v.as_bool()) == Some(true) {
                        // Said in the listing, so somebody deciding what to take knows
                        // before they take it that it will need a passphrase.
                        note = if note.is_empty() { "locked".into() } else { format!("{} · locked", note) };
                    }
                    table.add_row(vec![s("kind"), s("id"), s("name"), note]);
                }
                println!("{table}");
                println!("  {} {}", extras.len().to_string().cyan().bold(), "item(s)".dimmed());
            }
        }
        Commands::RepoTake { url, kind, id, password } => {
            let mut body = serde_json::json!({ "url": url, "kind": kind, "id": id });
            if let Some(pw) = password.filter(|p| !p.is_empty()) {
                body["password"] = serde_json::Value::String(pw);
            }
            let res = state_bridge::api_call("POST", "/api/repo/extras", Some(body)).await?;
            println!("{}", serde_json::to_string_pretty(res.get("body").unwrap_or(&serde_json::Value::Null))?);
        }

        // ── Identity keys ───────────────────────────────────
        Commands::Keys => {
            let res = state_bridge::api_call("GET", "/api/keys", None).await?;
            println!("{}", serde_json::to_string_pretty(res.get("body").unwrap_or(&serde_json::Value::Null))?);
        }
        Commands::NewKey { name, kind } => {
            let mut body = serde_json::json!({ "name": name });
            if let Some(k) = kind { body["kind"] = serde_json::Value::String(k); }
            let res = state_bridge::api_call("POST", "/api/keys", Some(body)).await?;
            let b = res.get("body").cloned().unwrap_or(serde_json::Value::Null);
            // The public line on its own, because that is the thing somebody has to paste
            // into a message, and hunting it out of a JSON blob is where it gets truncated.
            if let Some(pubkey) = b.get("public").and_then(|v| v.as_str()) {
                println!("  {} {}", "✓".green().bold(), "Key created. Give this line to whoever runs the source:".dimmed());
                println!("{}", pubkey);
                if let Some(path) = b.get("path").and_then(|v| v.as_str()) {
                    println!("  {} {}", "private half:".dimmed(), path);
                }
            } else {
                println!("{}", serde_json::to_string_pretty(&b)?);
            }
        }

        // ── Live app bridge ───────────────────────────────
        Commands::Call { method, path, body } => {
            let body_json = match body {
                Some(b) => Some(serde_json::from_str::<serde_json::Value>(&b)
                    .map_err(|e| anyhow::anyhow!("Body is not valid JSON: {}", e))?),
                None => None,
            };
            let res = state_bridge::api_call(&method, &path, body_json).await?;
            let status = res.get("status").and_then(|v| v.as_u64()).unwrap_or(0);
            let tag = if (200..300).contains(&status) { status.to_string().green().bold() } else { status.to_string().red().bold() };
            println!("  {} {}", "HTTP".dimmed(), tag);
            println!("{}", serde_json::to_string_pretty(res.get("body").unwrap_or(&serde_json::Value::Null))?);
        }

        // ── Session recorder / telemetry (running app) ───────────────
        Commands::Recorder { on, full, rust, js } => {
            let mut body = serde_json::Map::new();
            for (k, v) in [("on", on), ("full", full), ("rust", rust), ("js", js)] {
                if let Some(b) = v { body.insert(k.into(), b.into()); }
            }
            if body.is_empty() { anyhow::bail!("Nothing to change — pass at least one of --on/--full/--rust/--js true|false"); }
            let res = state_bridge::api_call("POST", "/api/recorder", Some(serde_json::Value::Object(body))).await?;
            println!("  {} recorder settings sent {}", "✓".green().bold(), format!("(HTTP {})", res.get("status").and_then(|v| v.as_u64()).unwrap_or(0)).dimmed());
        }
        Commands::Sessions => {
            let sessions: Vec<_> = state_bridge::list_crash_reports().into_iter()
                .filter(|r| r.category.contains("Session")).collect();
            if sessions.is_empty() {
                println!("  {}", "No recorded sessions.".dimmed());
            } else {
                let mut table = Table::new();
                table.load_preset(UTF8_FULL_CONDENSED);
                table.set_content_arrangement(ContentArrangement::Dynamic);
                table.set_header(vec!["Name", "Category", "Size", "Path"]);
                for s in &sessions {
                    table.add_row(vec![s.name.clone(), s.category.clone(), format!("{} KB", s.size / 1024), s.path.clone()]);
                }
                println!("{table}");
                println!("  {} {}", sessions.len().to_string().cyan().bold(), "session report(s)".dimmed());
            }
        }
        Commands::TelemetryConsent { enabled } => {
            let res = state_bridge::api_call("POST", "/api/telemetry/consent", Some(serde_json::json!({ "enabled": enabled }))).await?;
            println!("  {} telemetry consent → {} {}", "✓".green().bold(), enabled.to_string().cyan(), format!("(HTTP {})", res.get("status").and_then(|v| v.as_u64()).unwrap_or(0)).dimmed());
        }
        Commands::TelemetrySettings { replay, full, bench } => {
            let mut body = serde_json::Map::new();
            for (k, v) in [("replay", replay), ("full", full), ("bench", bench)] {
                if let Some(b) = v { body.insert(k.into(), b.into()); }
            }
            if body.is_empty() { anyhow::bail!("Nothing to change — pass at least one of --replay/--full/--bench true|false"); }
            let res = state_bridge::api_call("POST", "/api/telemetry/settings", Some(serde_json::Value::Object(body))).await?;
            println!("  {} telemetry settings sent {}", "✓".green().bold(), format!("(HTTP {})", res.get("status").and_then(|v| v.as_u64()).unwrap_or(0)).dimmed());
        }

        // ── Scheduling & automation ──────────────────────────────────
        Commands::Schedules => {
            let v = state_bridge::list_schedules()?;
            let tasks = v.as_array().cloned().unwrap_or_default();
            if tasks.is_empty() {
                println!("  {}", "No scheduled tasks.".dimmed());
            } else {
                let mut table = Table::new();
                table.load_preset(UTF8_FULL_CONDENSED);
                table.set_content_arrangement(ContentArrangement::Dynamic);
                table.set_header(vec!["", "ID", "Name", "Trigger", "Actions"]);
                for t in &tasks {
                    let s = |k: &str| t.get(k).and_then(|x| x.as_str()).unwrap_or("—").to_string();
                    let on = t.get("enabled").and_then(|x| x.as_bool()).unwrap_or(true);
                    let trig = t.get("trigger").map(|x| if x.is_string() { x.as_str().unwrap_or("—").to_string() } else { x.get("kind").and_then(|k| k.as_str()).unwrap_or("custom").to_string() }).unwrap_or_else(|| "—".into());
                    let n = t.get("actions").and_then(|x| x.as_array()).map(|a| a.len()).unwrap_or(0);
                    table.add_row(vec![(if on { "●" } else { "○" }).to_string(), s("id"), s("name"), trig, n.to_string()]);
                }
                println!("{table}");
                println!("  {} {}", tasks.len().to_string().cyan().bold(), "task(s)".dimmed());
            }
        }
        Commands::CreateSchedule { file, json } => {
            let raw = read_json_arg(file, json, "task.json")?;
            let task: serde_json::Value = serde_json::from_str(&raw)?;
            let res = state_bridge::save_schedule(task)?;
            println!("  {} schedule {} {}", "OK".green().bold(),
                res.get("id").and_then(|v| v.as_str()).unwrap_or("?").cyan(),
                if res.get("updated").and_then(|v| v.as_bool()).unwrap_or(false) { "updated" } else { "created (disabled - enable it in Settings)" }.dimmed());
        }

        Commands::DeleteSchedule { id } => {
            let res = state_bridge::delete_schedule(&id)?;
            println!("  {} deleted {} ({} remaining)", "OK".green().bold(), id.cyan(),
                res.get("remaining").and_then(|v| v.as_u64()).unwrap_or(0));
        }

        Commands::CreatePlugin { file, json, scripts } => {
            let raw = read_json_arg(file, json, "plugin.json")?;
            let manifest: serde_json::Value = serde_json::from_str(&raw)?;
            // The file NAME travels, the content is read here: the bridge only accepts plain
            // names (the name becomes a path inside the draft), so a caller cannot smuggle a
            // directory component through the CLI either.
            let mut bundled: Vec<(String, String)> = Vec::new();
            for p in &scripts {
                let path = std::path::Path::new(p);
                let name = path.file_name()
                    .and_then(|n| n.to_str())
                    .ok_or_else(|| anyhow::anyhow!("--script {p}: not a file path"))?
                    .to_string();
                let content = std::fs::read_to_string(path)
                    .map_err(|e| anyhow::anyhow!("--script {p}: {e}"))?;
                bundled.push((name, content));
            }
            let res = state_bridge::create_plugin_scaffold(manifest, bundled)?;
            println!("  {} plugin draft at {}", "OK".green().bold(),
                res.get("path").and_then(|v| v.as_str()).unwrap_or("?").cyan());
            println!("  zip its contents and install via Plugins & API -> Install from file");
        }

        Commands::Actions => {
            let v = state_bridge::list_schedule_actions();
            let list = v.get("actions").and_then(|a| a.as_array()).cloned().unwrap_or_default();
            println!("  {} action types
", list.len().to_string().cyan().bold());
            let mut group = String::new();
            for a in &list {
                let g = a.get("group").and_then(|x| x.as_str()).unwrap_or("");
                if g != group { println!("  {}", g.to_uppercase().bold()); group = g.to_string(); }
                println!("    {:<28} {}", a.get("type").and_then(|x| x.as_str()).unwrap_or("").green(),
                    a.get("label").and_then(|x| x.as_str()).unwrap_or(""));
            }
        }

        Commands::BmmsReference => {
            // Printed verbatim rather than re-serialised: the generator's field order groups
            // actions the way the builder does, and re-emitting it would sort that away.
            println!("{}", mcp::server::BMMS_VOCABULARY.trim_end());
        }

        Commands::BmmsCompile { file, source } => {
            let src = read_json_arg(file, source, "source.bmms")?;
            let out = commands::bmms::bmms_compile(src);
            if !out.ok || out.task.is_none() {
                // Diagnostics on stderr, nothing on stdout. This command is meant to sit in
                // a pipe, and a shell pipe does not care about an exit code — if the errors
                // went to stdout, `bmms-compile | create-schedule` would hand a parse error
                // to the saver and the saver would reject it with a message about JSON.
                for d in &out.errors {
                    eprintln!("  {} {}:{} {}", "✗".red().bold(), d.line, d.col, d.message);
                }
                if out.errors.is_empty() {
                    eprintln!("  {} the source compiled to nothing — is there a `task \"…\" {{ … }}` block?", "✗".red().bold());
                }
                std::process::exit(1);
            }
            // Every task in the file, when there is more than one; otherwise the single task
            // on its own, which is what `create-schedule` reads.
            let payload = match &out.tasks {
                Some(list) if list.len() > 1 => serde_json::Value::Array(list.clone()),
                _ => out.task.clone().unwrap_or(serde_json::Value::Null),
            };
            println!("{}", serde_json::to_string_pretty(&payload)?);
        }

        Commands::BmmsDecompile { file, json } => {
            let raw = read_json_arg(file, json, "task.json")?;
            let task: serde_json::Value = serde_json::from_str(&raw)?;
            print!("{}", commands::bmms::bmms_decompile(task));
        }

        Commands::RunSchedule { id } => {
            let res = state_bridge::api_call("POST", "/api/schedule/run", Some(serde_json::json!({ "id": id }))).await?;
            println!("  {} schedule '{}' triggered {}", "✓".green().bold(), id.cyan(), format!("(HTTP {})", res.get("status").and_then(|v| v.as_u64()).unwrap_or(0)).dimmed());
        }

        // ── Benchmark ────────────────────────────────────────────────
        Commands::Benchmark { dataset, size, mb, source, profile, auto } => {
            let mut body = serde_json::json!({ "dataset": dataset, "size": size, "mode": if auto { "auto" } else { "manual" } });
            if let Some(m) = mb { body["mb"] = m.into(); }
            if !source.is_empty() { body["sources"] = serde_json::json!(source); }
            if !profile.is_empty() { body["profiles"] = serde_json::json!(profile); }
            println!("  {} {}", "Launching benchmark…".bold(), if auto { "(auto — waiting for results)".dimmed() } else { "(opens pre-filled in the BMM UI)".dimmed() });
            let res = state_bridge::api_call("POST", "/api/benchmark", Some(body)).await?;
            println!("{}", serde_json::to_string_pretty(res.get("body").unwrap_or(&serde_json::Value::Null))?);
        }

        // ── Translation sandbox ──────────────────────────────────────
        Commands::LangTemplate { out } => {
            let res = state_bridge::api_call("GET", "/api/language/template", None).await?;
            let body = res.get("body").cloned().unwrap_or(serde_json::Value::Null);
            let pretty = serde_json::to_string_pretty(&body)?;
            match out {
                Some(p) => { std::fs::write(&p, &pretty)?; println!("  {} template written to {}", "✓".green().bold(), p.cyan()); }
                None => println!("{pretty}"),
            }
        }
        Commands::ImportLanguage { path } => {
            let res = state_bridge::api_call("POST", "/api/language/import", Some(serde_json::json!({ "path": path }))).await?;
            println!("  {} language import requested {}", "✓".green().bold(), format!("(HTTP {})", res.get("status").and_then(|v| v.as_u64()).unwrap_or(0)).dimmed());
        }

        // ── Themes ───────────────────────────────────────────────────
        Commands::ThemeApply { theme_id } => {
            let msg = state_bridge::apply_theme(&theme_id)?;
            println!("  {} {}", "✓".green().bold(), msg);
        }
        Commands::ThemeInfo { theme_id } => {
            let v = state_bridge::get_theme(&theme_id)?;
            println!("{}", serde_json::to_string_pretty(&v)?);
        }

        // ── Profiles ─────────────────────────────────────────────────
        Commands::Profiles => {
            let profs = profiles::list_profiles().map_err(|e| anyhow::anyhow!(e))?;
            let active = profiles::get_active_profile().ok().flatten();
            let active_id = active.as_ref().map(|p| p.id.as_str()).unwrap_or("");

            let mut table = Table::new();
            table.load_preset(UTF8_FULL_CONDENSED);
            table.set_content_arrangement(ContentArrangement::Dynamic);
            table.set_header(vec!["", "ID", "Name", "Game", "Mods Path"]);

            for p in &profs {
                let marker = if p.id == active_id { "►".green().to_string() } else { " ".to_string() };
                table.add_row(vec![
                    marker,
                    p.id.chars().take(8).collect::<String>() + "…",
                    p.name.clone(),
                    p.game_name.clone(),
                    p.mods_path.clone(),
                ]);
            }
            println!("{table}");
            println!("  {} profiles found.", profs.len().to_string().cyan().bold());
        }

        Commands::ActiveProfile => {
            match profiles::get_active_profile() {
                Ok(Some(p)) => {
                    println!("  {} {}", "Active Profile:".bold(), p.name.green());
                    println!("  {} {}", "ID:".bold(), p.id.dimmed());
                    println!("  {} {}", "Game:".bold(), p.game_name);
                    println!("  {} {}", "Mods Path:".bold(), p.mods_path);
                }
                Ok(None) => println!("  {}", "No active profile set.".yellow()),
                Err(e) => println!("  {} {}", "Error:".red().bold(), e),
            }
        }

        Commands::SetProfile { profile_id } => {
            match profiles::set_active_profile(&profile_id) {
                Ok(_) => println!("  {} Profile {} is now active.", "✓".green().bold(), profile_id.cyan()),
                Err(e) => println!("  {} {}", "✗".red().bold(), e),
            }
        }

        // ── Mods ─────────────────────────────────────────────────────
        Commands::Mods { profile, filter } => {
            let filter_opt = if filter == "all" { None } else { Some(filter.as_str()) };
            let mod_list = mods::list_mods(profile.as_deref(), filter_opt).map_err(|e| anyhow::anyhow!(e))?;

            let mut table = Table::new();
            table.load_preset(UTF8_FULL_CONDENSED);
            table.set_content_arrangement(ContentArrangement::Dynamic);
            table.set_header(vec!["Status", "Name", "Version", "Author", "ID"]);

            for m in &mod_list {
                let status = if m.enabled { "●".green().to_string() } else { "○".red().to_string() };
                table.add_row(vec![
                    status,
                    m.name.clone(),
                    m.version.clone(),
                    m.author.clone().unwrap_or_else(|| "—".to_string()),
                    m.id.chars().take(8).collect::<String>() + "…",
                ]);
            }
            println!("{table}");
            println!("  {} mods found.", mod_list.len().to_string().cyan().bold());
        }

        Commands::Mod { mod_id } => {
            match mods::get_mod_details(&mod_id) {
                Ok(m) => {
                    println!("  {} {}", "Name:".bold(), m.name.cyan());
                    println!("  {} {}", "ID:".bold(), m.id.dimmed());
                    println!("  {} {}", "Version:".bold(), m.version);
                    println!("  {} {}", "Author:".bold(), m.author.as_deref().unwrap_or("—"));
                    println!("  {} {}", "Status:".bold(), if m.enabled { "Enabled".green() } else { "Disabled".red() });
                    println!("  {} {}", "Files:".bold(), m.installed_file_count.to_string().cyan());
                    if let Some(desc) = &m.description {
                        if !desc.is_empty() {
                            println!("  {} {}", "Desc:".bold(), desc);
                        }
                    }
                    if !m.conflicts.is_empty() {
                        println!("  {} {} conflict(s)", "⚠ Conflicts:".yellow().bold(), m.conflicts.len());
                        for c in &m.conflicts {
                            println!("    → {} ({}, {} files)", c.other_mod_name, c.status, c.file_count);
                        }
                    }
                    if !m.tags.is_empty() {
                        println!("  {} {}", "Tags:".bold(), m.tags.join(", "));
                    }
                }
                Err(e) => println!("  {} {}", "✗".red().bold(), e),
            }
        }

        Commands::Search { query } => {
            match mods::search_mods(&query) {
                Ok(results) => {
                    if results.is_empty() {
                        println!("  {} No results for \"{}\"", "⚠".yellow(), query);
                    } else {
                        let mut table = Table::new();
                        table.load_preset(UTF8_FULL_CONDENSED);
                        table.set_content_arrangement(ContentArrangement::Dynamic);
                        table.set_header(vec!["Status", "Name", "Version", "ID"]);
                        for m in &results {
                            let status = if m.enabled { "●".green().to_string() } else { "○".red().to_string() };
                            table.add_row(vec![
                                status,
                                m.name.clone(),
                                m.version.clone(),
                                m.id.chars().take(8).collect::<String>() + "…",
                            ]);
                        }
                        println!("{table}");
                        println!("  {} results for \"{}\"", results.len().to_string().cyan().bold(), query);
                    }
                }
                Err(e) => println!("  {} {}", "✗".red().bold(), e),
            }
        }

        Commands::Enable { mod_id } => {
            match mods::set_mod_enabled(&mod_id, true) {
                Ok(_) => println!("  {} Mod {} enabled.", "✓".green().bold(), mod_id.cyan()),
                Err(e) => println!("  {} {}", "✗".red().bold(), e),
            }
        }

        Commands::Disable { mod_id } => {
            match mods::set_mod_enabled(&mod_id, false) {
                Ok(_) => println!("  {} Mod {} disabled.", "✓".green().bold(), mod_id.cyan()),
                Err(e) => println!("  {} {}", "✗".red().bold(), e),
            }
        }

        Commands::Sync => {
            println!("  {} Syncing active profile...", "⏳".yellow());
            match mods::sync_active_profile() {
                Ok(msg) => println!("  {} {}", "✓".green().bold(), msg),
                Err(e) => println!("  {} {}", "✗".red().bold(), e),
            }
        }

        // ── Repository ───────────────────────────────────────────────
        Commands::GenerateRepo { name, mod_ids } => {
            println!("  {} Generating repository \"{}\" with {} mods...", "⏳".yellow(), name.cyan(), mod_ids.len());
            match mods::generate_repo(&name, mod_ids) {
                Ok(msg) => println!("  {} {}", "✓".green().bold(), msg),
                Err(e) => println!("  {} {}", "✗".red().bold(), e),
            }
        }

        Commands::StartServer { path, port } => {
            println!("  {} Starting server on port {}...", "⏳".yellow(), port.to_string().cyan());
            match mods::start_repo_server(&path, port) {
                Ok(msg) => println!("  {}\n{}", "✓".green().bold(), msg),
                Err(e) => println!("  {} {}", "✗".red().bold(), e),
            }
        }

        Commands::GenerateLightweight {
            repo_path, port, auto_start, cloudflare, upnp,
            upload_limit, server_version, password,
        } => {
            println!("  {} Generating standalone server script...", "⏳".yellow());
            // Docker generation is a GUI-driven feature; the CLI generates the
            // classic standalone script (no docker, default host type).
            match mods::generate_lightweight_server(
                &repo_path, port, auto_start, cloudflare, upnp, upload_limit, server_version, &password,
                false, "linux", "node",
            ) {
                Ok(msg) => println!("  {} {}", "✓".green().bold(), msg),
                Err(e) => println!("  {} {}", "✗".red().bold(), e),
            }
        }

        // ── Diagnostics ──────────────────────────────────────────────
        Commands::Stats => {
            match diagnostics::get_statistics() {
                Ok(stats) => println!("{}", serde_json::to_string_pretty(&stats).unwrap_or_default()),
                Err(e) => println!("  {} {}", "✗".red().bold(), e),
            }
        }

        Commands::Crashes { limit } => {
            let reports = diagnostics::list_crash_reports(Some(limit));
            {
                    if reports.is_empty() {
                        println!("  {} No crash reports found.", "✓".green());
                    } else {
                        let mut table = Table::new();
                        table.load_preset(UTF8_FULL_CONDENSED);
                        table.set_content_arrangement(ContentArrangement::Dynamic);
                        table.set_header(vec!["#", "File", "Size"]);
                        for (i, r) in reports.iter().enumerate() {
                            table.add_row(vec![
                                (i + 1).to_string(),
                                r.name.clone(),
                                r.size.to_string(),
                            ]);
                        }
                        println!("{table}");
                        println!("  {} crash reports.", reports.len().to_string().cyan().bold());
                    }
            }
        }

        Commands::Crash { report_path } => {
            match diagnostics::analyze_crash_report(&report_path) {
                Ok(analysis) => println!("{}", serde_json::to_string_pretty(&analysis).unwrap_or_default()),
                Err(e) => println!("  {} {}", "✗".red().bold(), e),
            }
        }

        Commands::ExportConfig { target_path } => {
            match state_bridge::export_config(&target_path) {
                Ok(_) => println!("  {} Config exported to {}", "✓".green().bold(), target_path.cyan()),
                Err(e) => println!("  {} {}", "✗".red().bold(), e),
            }
        }

        // ── Launch Packs ──────────────────────────────────────────────
        Commands::LaunchPacks => {
            let packs = launch_packs::list_launch_packs().map_err(|e| anyhow::anyhow!(e))?;
            if packs.is_empty() {
                println!("  {} No launch packs configured.", "⚠".yellow());
            } else {
                let mut table = Table::new();
                table.load_preset(UTF8_FULL_CONDENSED);
                table.set_content_arrangement(ContentArrangement::Dynamic);
                table.set_header(vec!["ID", "Name", "Apps", "Created"]);
                for p in &packs {
                    table.add_row(vec![
                        p.id.chars().take(8).collect::<String>() + "…",
                        p.name.clone(),
                        p.executable_paths.len().to_string(),
                        p.created_at.clone().split('T').next().unwrap_or("—").to_string(),
                    ]);
                }
                println!("{table}");
                println!("  {} launch packs found.", packs.len().to_string().cyan().bold());
            }
        }

        Commands::RunPack { id } => {
            println!("  {} Running launch pack {}...", "⏳".yellow(), id.cyan());
            match launch_packs::run_launch_pack(&id) {
                Ok(msg) => println!("  {} {}", "✓".green().bold(), msg),
                Err(e) => println!("  {} {}", "✗".red().bold(), e),
            }
        }

        Commands::DeletePack { id } => {
            match launch_packs::delete_launch_pack(&id) {
                Ok(msg) => println!("  {} {}", "✓".green().bold(), msg),
                Err(e) => println!("  {} {}", "✗".red().bold(), e),
            }
        }

        Commands::OpenPack { id } => {
            match launch_packs::open_launch_pack_folder(&id) {
                Ok(msg) => println!("  {} {}", "✓".green().bold(), msg),
                Err(e) => println!("  {} {}", "✗".red().bold(), e),
            }
        }
    }

    Ok(())
}
