//! MCP Tools — Diagnostics & Crash Analysis

#![allow(dead_code)]
use crate::mcp::state_bridge;
use serde::Serialize;

/// Summary of the BMM installation
#[derive(Debug, Serialize)]
pub struct AppStatistics {
    pub bmm_version: String,
    pub total_profiles: usize,
    pub total_mods: usize,
    pub enabled_mods: usize,
    pub disabled_mods: usize,
    pub total_conflicts: usize,
    pub active_conflicts: usize,
    pub total_tags: usize,
    pub active_profile: Option<String>,
    pub language: String,
    pub security_mode: Option<String>,
}

/// Structured crash analysis output
#[derive(Debug, Serialize)]
pub struct CrashAnalysis {
    pub report_name: String,
    pub bmm_version: String,
    pub timestamp: String,
    pub reason: String,
    pub has_stacktrace: bool,
    pub has_dxdiag: bool,
    pub has_frontend_dump: bool,
    pub system_summary: String,
    pub error_lines: Vec<String>,
    pub warning_lines: Vec<String>,
    pub full_logs: String,
    pub stacktrace: Option<String>,
}

/// Get overall statistics about the BMM installation
pub fn get_statistics() -> Result<AppStatistics, String> {
    let data = state_bridge::read_app_data()
        .map_err(|e| format!("Failed to read BMM data: {}", e))?;

    let enabled = data.mods.iter().filter(|m| m.enabled).count();
    let total_conflicts: usize = data.mods.iter().map(|m| m.conflicts.len()).sum();
    let active_conflicts: usize = data.mods.iter()
        .flat_map(|m| m.conflicts.iter())
        .filter(|c| c.status == state_bridge::ConflictStatus::Active)
        .count();

    let active_profile_name = data.active_profile_id.as_ref()
        .and_then(|id| data.profiles.iter().find(|p| &p.id == id))
        .map(|p| p.name.clone());

    Ok(AppStatistics {
        bmm_version: env!("CARGO_PKG_VERSION").to_string(),
        total_profiles: data.profiles.len(),
        total_mods: data.mods.len(),
        enabled_mods: enabled,
        disabled_mods: data.mods.len() - enabled,
        total_conflicts,
        active_conflicts,
        total_tags: data.custom_tags.len(),
        active_profile: active_profile_name,
        language: data.settings.language.clone(),
        security_mode: data.settings.fs_security_mode.clone(),
    })
}

/// List available crash reports
pub fn list_crash_reports(limit: Option<usize>) -> Vec<state_bridge::CrashReportSummary> {
    let mut reports = state_bridge::list_crash_reports();
    if let Some(lim) = limit {
        reports.truncate(lim);
    }
    reports
}

/// Read and analyze a crash report zip
pub fn analyze_crash_report(report_path: &str) -> Result<CrashAnalysis, String> {
    let content = state_bridge::read_crash_report(report_path)
        .map_err(|e| format!("Failed to read crash report: {}", e))?;

    // Parse metadata
    let mut version = String::new();
    let mut timestamp = String::new();
    let mut reason = String::new();

    for line in content.metadata.lines() {
        let line = line.trim();
        if let Some(v) = line.strip_prefix("BMM VERSION:") {
            version = v.trim().to_string();
        } else if let Some(t) = line.strip_prefix("TIMESTAMP:") {
            timestamp = t.trim().to_string();
        } else if let Some(r) = line.strip_prefix("REASON:") {
            reason = r.trim().to_string();
        }
    }

    // Extract error and warning lines from logs
    let error_lines: Vec<String> = content.logs.lines()
        .filter(|l| {
            let lower = l.to_lowercase();
            lower.contains("error") || lower.contains("panic") || lower.contains("crash")
                || lower.contains("failed") || lower.contains("critical")
        })
        .map(String::from)
        .collect();

    let warning_lines: Vec<String> = content.logs.lines()
        .filter(|l| {
            let lower = l.to_lowercase();
            lower.contains("warn") || lower.contains("timeout") || lower.contains("retry")
        })
        .map(String::from)
        .collect();

    // Extract system summary (first 15 lines of system_info)
    let system_summary: String = content.system_info.lines()
        .take(15)
        .collect::<Vec<&str>>()
        .join("\n");

    // Use the report filename
    let report_name = std::path::Path::new(report_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    Ok(CrashAnalysis {
        report_name,
        bmm_version: version,
        timestamp,
        reason,
        has_stacktrace: content.stacktrace.is_some(),
        has_dxdiag: content.dxdiag.is_some(),
        has_frontend_dump: content.frontend_dump.is_some(),
        system_summary,
        error_lines,
        warning_lines,
        full_logs: content.logs,
        stacktrace: content.stacktrace,
    })
}

/// Get the raw crash report content for maximum detail
pub fn read_crash_report_raw(report_path: &str) -> Result<state_bridge::CrashReportContent, String> {
    state_bridge::read_crash_report(report_path)
        .map_err(|e| format!("Failed to read crash report: {}", e))
}
