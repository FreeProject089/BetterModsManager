//! BMM MCP Server — Binary Entry Point
//!
//! Standalone binary that exposes Better Mods Manager data via MCP (Model Context Protocol).
//! Communicates over Stdio (JSON-RPC 2.0) for compatibility with Claude Desktop, Cursor, etc.
//!
//! Usage:
//!   bmm-mcp-server              # Starts the server (stdin/stdout)
//!   BMM_DATA_DIR=... bmm-mcp    # Custom data directory
//!
//! Configuration (Claude Desktop):
//!   {
//!     "mcpServers": {
//!       "bmm": {
//!         "command": "path/to/bmm-mcp-server.exe"
//!       }
//!     }
//!   }

// Allow the binary to reference the main crate's modules
#[path = "../mcp/mod.rs"]
mod mcp;

// We need to bring in the models used by state_bridge
// Since this is a separate binary, we import via path

use mcp::server::BmmMcpServer;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize stderr logging (stdout is reserved for MCP JSON-RPC)
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

    // Verify we can find BMM data
    let data_dir = mcp::state_bridge::get_bmm_data_dir();
    let data_path = data_dir.join("data.json");

    if data_path.exists() {
        tracing::info!("Found BMM data at {:?}", data_path);
    } else {
        tracing::warn!(
            "BMM data.json not found at {:?}. Tools will return errors until BMM creates it. \
             Set BMM_DATA_DIR env var to override.",
            data_path
        );
    }

    // Create the MCP server
    let server = BmmMcpServer::new();

    // Start serving via stdio transport
    tracing::info!("MCP server ready, listening on stdio...");

    let service = rmcp::ServiceExt::serve(server, rmcp::transport::stdio()).await?;

    // Wait for the client to disconnect
    service.waiting().await?;

    tracing::info!("MCP server shutting down.");
    Ok(())
}
