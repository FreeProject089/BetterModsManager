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

#[path = "../mcp/mod.rs"]
mod mcp;

use clap::{Parser, Subcommand};
use colored::Colorize;
use comfy_table::{Table, ContentArrangement, presets::UTF8_FULL_CONDENSED};
use mcp::server::BmmMcpServer;
use mcp::state_bridge;
use mcp::tools::{mods, profiles, diagnostics};

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
            match mods::generate_lightweight_server(
                &repo_path, port, auto_start, cloudflare, upnp, upload_limit, server_version, &password
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
    }

    Ok(())
}
