//! The extras written next to a generated standalone repo server.
//!
//! Every Node edition of the standalone server (Express, v1 hybrid, v2 Lux) loads
//! `bmm-extras.js` from its folder: a status page, `/health`, the Atom feed, ETag/304, ranged
//! (resumable) downloads, rate limiting and scheduled jobs (rescan/rehash, sync from a source,
//! backup of repo.json, log rotation). This file writes that module, its configuration
//! (`server.config.json`, built from what the owner chose in BMM), a README in English and in
//! French, a systemd unit, a Windows scheduled-task script and a self-test.
//!
//! Shared by the app's generator (`commands::repo`) and the MCP/CLI one (`mcp::state_bridge`),
//! like `docker_export.rs`: std, serde and serde_json only, so the `bmm-mcp-server` example can
//! mount it.
//!
//! Nothing written here at the folder root is served (the servers serve only `repo.json` and
//! `Info.json` there), and `bmm-server/` is refused by every edition and by BMM's built-in server.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const EXTRAS_JS: &str = include_str!("../templates/mini-server/bmm-extras.js.template");
const SELFTEST_JS: &str = include_str!("../templates/mini-server/selftest.js.template");
const README_EN: &str = include_str!("../templates/mini-server/README-SERVER.md.template");
const README_FR: &str = include_str!("../templates/mini-server/README-SERVER.fr.md.template");
const SYSTEMD_UNIT: &str = include_str!("../templates/mini-server/bmm-repo.service.template");
const WINDOWS_TASK: &str = include_str!("../templates/mini-server/windows-task.ps1.template");
// Used by write_access_modules, which only the MCP/CLI generator calls (the app has its own).
#[allow(dead_code)]
const ACCESS_GATE_JS: &str = include_str!("../templates/mini-server/access-gate.js.template");
#[allow(dead_code)]
const KEYAUTH_MJS: &str = include_str!("../templates/mini-server/keyauth.mjs.template");

/// The folder the extras keep to themselves (job state, backups, service files). Never served.
pub const PRIVATE_DIR: &str = "bmm-server";

/// What the owner chose in BMM's generator. Every field is optional: an empty payload gives
/// the defaults (status page on, rescan every 6 h without rewriting, daily backup, log rotation).
#[derive(Debug, Clone, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct MiniServerExtras {
    pub status_page: bool,
    /// The address subscribers type, for the feed and the « Open in BMM » link. Blank = taken
    /// from the request (or from access.json's `audience`).
    pub public_url: String,
    /// Requests per minute per address. 0 = off.
    pub rate_limit_per_minute: u32,
    /// "6h", "15m", a cron line ("0 3 * * *"), or blank for no scheduled rescan.
    pub rescan: String,
    /// Rewrite the hashes of an UNSIGNED manifest when a file changed.
    pub rescan_rewrite: bool,
    pub bump_version: bool,
    pub backup: String,
    pub backup_keep: u32,
    pub rotate_logs: bool,
    pub log_max_mb: u32,
    /// "", "git", "rsync", "folder".
    pub sync_kind: String,
    pub sync_source: String,
    pub sync_schedule: String,
    pub sync_then_rescan: bool,
}

impl Default for MiniServerExtras {
    fn default() -> Self {
        Self {
            status_page: true,
            public_url: String::new(),
            rate_limit_per_minute: 0,
            rescan: "6h".into(),
            rescan_rewrite: false,
            bump_version: false,
            backup: "0 3 * * *".into(),
            backup_keep: 14,
            rotate_logs: true,
            log_max_mb: 10,
            sync_kind: String::new(),
            sync_source: String::new(),
            sync_schedule: "30m".into(),
            sync_then_rescan: true,
        }
    }
}

/// Is this a cron line (five fields or an @alias) rather than an interval?
fn is_cron(s: &str) -> bool {
    let s = s.trim();
    s.starts_with('@') || s.split_whitespace().count() > 1
}

/// The same grammar `bmm-extras.js` reads, checked here so a typo is refused in BMM instead of
/// being logged as « unreadable schedule » on a machine the owner may not look at.
pub fn schedule_ok(s: &str) -> bool {
    let s = s.trim();
    if s.is_empty() {
        return false;
    }
    if is_cron(s) {
        const ALIASES: [&str; 7] = ["@hourly", "@daily", "@midnight", "@weekly", "@monthly", "@yearly", "@annually"];
        if s.starts_with('@') {
            return ALIASES.contains(&s.to_ascii_lowercase().as_str());
        }
        let fields: Vec<&str> = s.split_whitespace().collect();
        const RANGES: [(u32, u32); 5] = [(0, 59), (0, 23), (1, 31), (1, 12), (0, 7)];
        return fields.len() == 5 && fields.iter().zip(RANGES).all(|(f, (lo, hi))| cron_field_ok(f, lo, hi));
    }
    let unit_at = s.find(|c: char| c.is_ascii_alphabetic()).unwrap_or(s.len());
    let (num, unit) = s.split_at(unit_at);
    let mult = match unit.to_ascii_lowercase().as_str() {
        "s" => 1.0,
        "" | "m" => 60.0,
        "h" => 3600.0,
        "d" => 86400.0,
        "w" => 604800.0,
        _ => return false,
    };
    num.parse::<f64>().map(|n| n.is_finite() && n * mult >= 10.0).unwrap_or(false)
}

fn cron_field_ok(f: &str, lo: u32, hi: u32) -> bool {
    f.split(',').all(|part| {
        let (base, step) = match part.split_once('/') {
            Some((b, st)) => (b, Some(st)),
            None => (part, None),
        };
        if let Some(st) = step {
            if st.parse::<u32>().map(|n| n == 0).unwrap_or(true) {
                return false;
            }
        }
        if base == "*" {
            return true;
        }
        let (a, b) = match base.split_once('-') {
            Some((a, b)) => (a.parse::<u32>(), b.parse::<u32>()),
            None => (base.parse::<u32>(), base.parse::<u32>()),
        };
        matches!((a, b), (Ok(a), Ok(b)) if a >= lo && b <= hi && a <= b)
    })
}

fn schedule_json(s: &str) -> (String, serde_json::Value) {
    let s = s.trim();
    if is_cron(s) { ("cron".into(), s.into()) } else { ("every".into(), s.into()) }
}

/// `server.config.json`, from the owner's choices. Err is an i18n key.
pub fn build_config(x: &MiniServerExtras) -> Result<serde_json::Value, String> {
    let mut jobs: Vec<serde_json::Value> = Vec::new();
    let mut push = |id: &str, kind: &str, sched: &str, extra: serde_json::Value| -> Result<(), String> {
        if !schedule_ok(sched) {
            return Err("repo.mini.errSchedule".into());
        }
        let (k, v) = schedule_json(sched);
        let mut job = serde_json::json!({ "id": id, "type": kind, "enabled": true });
        job[k.as_str()] = v;
        if let (Some(o), Some(e)) = (job.as_object_mut(), extra.as_object()) {
            for (a, b) in e {
                o.insert(a.clone(), b.clone());
            }
        }
        jobs.push(job);
        Ok(())
    };
    if !x.rescan.trim().is_empty() {
        push("rescan", "rescan", &x.rescan, serde_json::json!({ "rewrite": x.rescan_rewrite, "bumpVersion": x.bump_version, "fullHash": false }))?;
    }
    if !x.backup.trim().is_empty() {
        push("backup", "backup", &x.backup, serde_json::json!({ "keep": x.backup_keep.clamp(1, 1000) }))?;
    }
    if x.rotate_logs {
        push("rotate-logs", "rotateLogs", "1h", serde_json::json!({ "maxSizeMB": x.log_max_mb.clamp(1, 10_000), "keep": 5 }))?;
    }
    let kind = x.sync_kind.trim().to_ascii_lowercase();
    if !kind.is_empty() {
        let source = match kind.as_str() {
            "git" => serde_json::json!({ "kind": "git" }),
            "rsync" | "folder" => {
                if x.sync_source.trim().is_empty() {
                    return Err("repo.mini.errSyncSource".into());
                }
                serde_json::json!({ "kind": kind, "path": x.sync_source.trim() })
            }
            _ => return Err("repo.mini.errSyncKind".into()),
        };
        push("sync", "sync", &x.sync_schedule, serde_json::json!({
            "source": source, "thenRescan": x.sync_then_rescan, "rewrite": x.rescan_rewrite, "bumpVersion": x.bump_version,
        }))?;
    }
    let url = x.public_url.trim().trim_end_matches('/');
    if !url.is_empty() && !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("repo.mini.errPublicUrl".into());
    }
    let per = x.rate_limit_per_minute;
    Ok(serde_json::json!({
        "_comment": [
            "Read by bmm-extras.js, re-read when it changes. README-SERVER.md explains every key.",
            "publicUrl: the address subscribers type (https://repo.example.com); blank = from the request.",
            "rateLimit.perMinute: requests per minute per address, 0 = off. Your own machine is never limited.",
            "jobs: every entry has an id, a type (rescan, sync, backup, rotateLogs) and \"every\" (15m, 6h, 1d) or \"cron\" (0 3 * * *).",
            "A signed repo.json is never rewritten by a rescan: re-export it from BMM to re-sign it."
        ],
        "publicUrl": url,
        "statusPage": x.status_page,
        "rateLimit": { "perMinute": per, "burst": if per == 0 { 0 } else { (per / 2).max(1) } },
        "logs": { "maxSizeMB": x.log_max_mb.clamp(1, 10_000), "keep": 5 },
        "jobs": jobs,
    }))
}

/// The jobs, one Markdown bullet each, for the README.
fn jobs_markdown(cfg: &serde_json::Value) -> String {
    let jobs = cfg["jobs"].as_array().cloned().unwrap_or_default();
    if jobs.is_empty() {
        return "- (none)".into();
    }
    jobs.iter()
        .map(|j| {
            let when = j["cron"].as_str().map(|c| format!("cron `{c}`")).or_else(|| j["every"].as_str().map(|e| format!("every `{e}`"))).unwrap_or_default();
            format!("- `{}` ({}), {}", j["id"].as_str().unwrap_or(""), j["type"].as_str().unwrap_or(""), when)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// How the folder is started, per edition: (label, Windows, Linux, entry file).
fn edition(server_type: &str, server_version: u8) -> (&'static str, &'static str, &'static str, &'static str) {
    if server_type == "server" {
        ("Node.js + Express", "`BMM-Standalone-Server.bat` (runs `npm install`, then `npm start`)", "`sh BMM-Standalone-Server.sh` (or `npm install && npm start`)", "server.js")
    } else if server_version == 2 {
        ("v2 script", "double-click `BMM-Standalone-Server.bat` (downloads a checked Node.js if missing)", "`sh BMM-Standalone-Server.sh` (Node.js 18+)", "BMM-Standalone-Server.sh")
    } else {
        ("v1 script", "double-click `BMM-Standalone-Server.bat` (downloads a checked Node.js if missing)", "`sh BMM-Standalone-Server.sh` (Node.js 18+)", "BMM-Standalone-Server.sh")
    }
}

/// Write a file only when its content differs (keeps mtimes stable for a re-generation).
fn put(path: &Path, body: &str, written: &mut Vec<PathBuf>) -> io::Result<()> {
    if fs::read_to_string(path).map(|old| old == body).unwrap_or(false) {
        return Ok(());
    }
    fs::write(path, body)?;
    written.push(path.to_path_buf());
    Ok(())
}

/// The access gate (`access-gate.js`, `keyauth.mjs`) and an open `access.json` when there is
/// none. Every edition requires the gate and the Dockerfiles copy all three. The app's exporter
/// has its own (commented) starter; this is for the MCP/CLI generator, which wrote none.
#[allow(dead_code)]
pub fn write_access_modules(out: &Path) -> io::Result<()> {
    fs::write(out.join("access-gate.js"), ACCESS_GATE_JS)?;
    fs::write(out.join("keyauth.mjs"), KEYAUTH_MJS)?;
    let acc = out.join("access.json");
    if !acc.exists() {
        fs::write(acc, "{ \"password\": \"\", \"pubkeys\": [], \"audience\": \"\" }\n")?;
    }
    Ok(())
}

/// Put the download password the owner typed in BMM into `access.json`, which every edition
/// reads. The script editions never had a place for it: a password set in the generator was
/// silently ignored by them. An access.json that already sets a password is the owner's own
/// edit and is kept; returns whether the file was changed.
pub fn seed_download_password(out: &Path, password: &str) -> io::Result<bool> {
    let pw = password.trim();
    if pw.is_empty() {
        return Ok(false);
    }
    let file = out.join("access.json");
    let mut j: serde_json::Value = fs::read_to_string(&file)
        .ok()
        .and_then(|s| serde_json::from_str(s.trim_start_matches('\u{feff}')).ok())
        .unwrap_or_else(|| serde_json::json!({ "password": "", "pubkeys": [], "audience": "" }));
    if !j.is_object() {
        return Ok(false);
    }
    if j["password"].as_str().map(|p| !p.is_empty()).unwrap_or(false) {
        return Ok(false);
    }
    j["password"] = pw.into();
    fs::write(&file, serde_json::to_string_pretty(&j).unwrap_or_default())?;
    Ok(true)
}

/// The compose file for these extras: a job that rewrites repo.json or pulls new files needs
/// the repo mounted read-write.
pub fn compose_for(template: &str, x: &MiniServerExtras) -> String {
    let writes = x.rescan_rewrite || !x.sync_kind.trim().is_empty();
    if !writes {
        return template.to_string();
    }
    template
        .replace("- ./mods:/app/mods:ro", "- ./mods:/app/mods")
        .replace("- ./repo.json:/app/repo.json:ro", "- ./repo.json:/app/repo.json")
}

/// Write the extras into `out`. Returns the files that changed.
pub fn write_extras(out: &Path, port: u16, server_type: &str, server_version: u8, x: &MiniServerExtras) -> Result<Vec<PathBuf>, String> {
    let cfg = build_config(x)?;
    let io_err = |_: io::Error| "repo.mini.errWrite".to_string();
    let mut written = Vec::new();
    let private = out.join(PRIVATE_DIR);
    fs::create_dir_all(&private).map_err(io_err)?;

    put(&out.join("bmm-extras.js"), EXTRAS_JS, &mut written).map_err(io_err)?;

    // The owner may have edited the previous config by hand: keep it beside the new one.
    let cfg_path = out.join("server.config.json");
    let cfg_text = serde_json::to_string_pretty(&cfg).unwrap_or_default();
    if let Ok(prev) = fs::read_to_string(&cfg_path) {
        if prev != cfg_text {
            fs::write(private.join("server.config.previous.json"), prev).map_err(io_err)?;
        }
    }
    put(&cfg_path, &cfg_text, &mut written).map_err(io_err)?;

    let (label, start_win, start_linux, entry) = edition(server_type, server_version);
    let port_s = port.to_string();
    let jobs = jobs_markdown(&cfg);
    for (name, tpl) in [("README-SERVER.md", README_EN), ("README-SERVER.fr.md", README_FR)] {
        let body = tpl
            .replace("{{EDITION}}", label)
            .replace("{{START_WINDOWS}}", start_win)
            .replace("{{START_LINUX}}", start_linux)
            .replace("{{JOBS}}", &jobs)
            .replace("{{PORT}}", &port_s);
        put(&out.join(name), &body, &mut written).map_err(io_err)?;
    }
    let prepare = if server_type == "server" { "#   0. In the folder, first: npm install --omit=dev\n" } else { "" };
    let unit = SYSTEMD_UNIT.replace("{{PREPARE_NOTE}}\n", prepare).replace("{{ENTRY}}", entry).replace("{{PORT}}", &port_s);
    put(&private.join("bmm-repo.service"), &unit, &mut written).map_err(io_err)?;
    let entry_win = if server_type == "server" { "server.js" } else { "BMM-Standalone-Server.bat" };
    // CRLF: Windows PowerShell 5.1 reads either, Notepad shows LF files as one line on old builds.
    let task = WINDOWS_TASK.replace("{{ENTRY_WINDOWS}}", entry_win).replace("{{PORT}}", &port_s).replace("\r\n", "\n").replace('\n', "\r\n");
    put(&private.join("windows-task.ps1"), &task, &mut written).map_err(io_err)?;
    put(&private.join("selftest.js"), SELFTEST_JS, &mut written).map_err(io_err)?;
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("bmm-mini-extras-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn schedules_accept_intervals_and_cron_and_refuse_typos() {
        for ok in ["15m", "6h", "1d", "2w", "90s", "30", "0 3 * * *", "*/15 * * * 1-5", "0 0,12 1 */2 *", "@daily", "@HOURLY"] {
            assert!(schedule_ok(ok), "{ok} refused");
        }
        for bad in ["", "5s", "6x", "h", "0 3 * *", "61 * * * *", "* 24 * * *", "*/0 * * * *", "5-1 * * * *", "@sometimes", "0 0 32 * *"] {
            assert!(!schedule_ok(bad), "{bad} accepted");
        }
    }

    #[test]
    fn the_default_config_has_rescan_backup_and_rotation_and_no_sync() {
        let cfg = build_config(&MiniServerExtras::default()).unwrap();
        let ids: Vec<&str> = cfg["jobs"].as_array().unwrap().iter().map(|j| j["id"].as_str().unwrap()).collect();
        assert_eq!(ids, ["rescan", "backup", "rotate-logs"]);
        assert_eq!(cfg["jobs"][0]["every"], "6h");
        assert_eq!(cfg["jobs"][0]["rewrite"], false, "a rescan only reports unless asked");
        assert_eq!(cfg["jobs"][1]["cron"], "0 3 * * *");
        assert_eq!(cfg["statusPage"], true);
        assert_eq!(cfg["rateLimit"]["perMinute"], 0);
    }

    #[test]
    fn a_sync_needs_a_known_kind_and_a_source() {
        let mut x = MiniServerExtras { sync_kind: "folder".into(), ..Default::default() };
        assert_eq!(build_config(&x).unwrap_err(), "repo.mini.errSyncSource");
        x.sync_source = "/srv/export".into();
        let cfg = build_config(&x).unwrap();
        let sync = cfg["jobs"].as_array().unwrap().iter().find(|j| j["id"] == "sync").unwrap().clone();
        assert_eq!(sync["source"]["kind"], "folder");
        assert_eq!(sync["source"]["path"], "/srv/export");
        assert_eq!(sync["every"], "30m");
        x.sync_kind = "ftp".into();
        assert_eq!(build_config(&x).unwrap_err(), "repo.mini.errSyncKind");
        let git = MiniServerExtras { sync_kind: "git".into(), ..Default::default() };
        assert!(build_config(&git).is_ok(), "git needs no path: it pulls the folder's own remote");
    }

    #[test]
    fn a_bad_schedule_or_url_is_refused_in_bmm() {
        let x = MiniServerExtras { rescan: "every day".into(), ..Default::default() };
        assert_eq!(build_config(&x).unwrap_err(), "repo.mini.errSchedule");
        let y = MiniServerExtras { public_url: "repo.example.com".into(), ..Default::default() };
        assert_eq!(build_config(&y).unwrap_err(), "repo.mini.errPublicUrl");
        let off = MiniServerExtras { rescan: String::new(), backup: String::new(), rotate_logs: false, ..Default::default() };
        assert!(build_config(&off).unwrap()["jobs"].as_array().unwrap().is_empty());
    }

    #[test]
    fn the_payload_deserialises_from_the_frontend_shape() {
        let x: MiniServerExtras = serde_json::from_value(serde_json::json!({ "rescan": "1h", "rescanRewrite": true, "rateLimitPerMinute": 600 })).unwrap();
        assert_eq!(x.rescan, "1h");
        assert!(x.rescan_rewrite);
        assert_eq!(x.backup, "0 3 * * *", "missing fields keep their defaults");
        let cfg = build_config(&x).unwrap();
        assert_eq!(cfg["rateLimit"]["burst"], 300);
    }

    #[test]
    fn write_extras_lays_out_the_folder_and_fills_every_placeholder() {
        let d = tmp("write");
        let written = write_extras(&d, 8123, "user", 2, &MiniServerExtras::default()).unwrap();
        for f in ["bmm-extras.js", "server.config.json", "README-SERVER.md", "README-SERVER.fr.md"] {
            assert!(d.join(f).is_file(), "{f} missing");
        }
        for f in ["bmm-repo.service", "windows-task.ps1", "selftest.js"] {
            assert!(d.join(PRIVATE_DIR).join(f).is_file(), "bmm-server/{f} missing");
        }
        assert_eq!(written.len(), 7);
        for f in ["README-SERVER.md", "README-SERVER.fr.md", "bmm-server/bmm-repo.service", "bmm-server/windows-task.ps1"] {
            let body = fs::read_to_string(d.join(f)).unwrap();
            assert!(!body.contains("{{"), "{f} kept a placeholder");
            assert!(body.contains("8123"), "{f} lost the port");
        }
        let readme = fs::read_to_string(d.join("README-SERVER.md")).unwrap();
        assert!(readme.contains("- `rescan` (rescan), every `6h`"), "the README lists the jobs");
        let unit = fs::read_to_string(d.join("bmm-server/bmm-repo.service")).unwrap();
        assert!(unit.contains("ExecStart=/usr/bin/env node BMM-Standalone-Server.sh"));
        assert!(fs::read_to_string(d.join("bmm-server/windows-task.ps1")).unwrap().contains("\r\n"));
        // A second run with the same choices rewrites nothing.
        assert!(write_extras(&d, 8123, "user", 2, &MiniServerExtras::default()).unwrap().is_empty());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn the_express_edition_runs_server_js_after_npm_install() {
        let d = tmp("express");
        write_extras(&d, 3000, "server", 1, &MiniServerExtras::default()).unwrap();
        let unit = fs::read_to_string(d.join("bmm-server/bmm-repo.service")).unwrap();
        assert!(unit.contains("ExecStart=/usr/bin/env node server.js") && unit.contains("npm install"));
        assert!(fs::read_to_string(d.join("bmm-server/windows-task.ps1")).unwrap().contains("'server.js'"));
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn a_hand_edited_config_is_kept_aside_when_regenerated() {
        let d = tmp("prev");
        fs::write(d.join("server.config.json"), "{\"mine\":true}").unwrap();
        write_extras(&d, 8000, "user", 2, &MiniServerExtras::default()).unwrap();
        assert_eq!(fs::read_to_string(d.join("bmm-server/server.config.previous.json")).unwrap(), "{\"mine\":true}");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn the_download_password_reaches_access_json_unless_the_owner_set_one() {
        let d = tmp("pw");
        fs::write(d.join("access.json"), "{\"_comment\":[\"x\"],\"password\":\"\",\"pubkeys\":[],\"audience\":\"\"}").unwrap();
        assert!(seed_download_password(&d, "s3cret").unwrap());
        let j: serde_json::Value = serde_json::from_str(&fs::read_to_string(d.join("access.json")).unwrap()).unwrap();
        assert_eq!(j["password"], "s3cret");
        assert_eq!(j["_comment"][0], "x", "the rest of the file is kept");
        assert!(!seed_download_password(&d, "other").unwrap(), "an existing password is the owner's");
        assert!(!seed_download_password(&d, "  ").unwrap());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn compose_mounts_read_write_only_when_a_job_writes() {
        let tpl = "      - ./mods:/app/mods:ro\n      - ./repo.json:/app/repo.json:ro\n";
        assert_eq!(compose_for(tpl, &MiniServerExtras::default()), tpl);
        let rw = compose_for(tpl, &MiniServerExtras { rescan_rewrite: true, ..Default::default() });
        assert!(!rw.contains(":ro"));
    }

    #[test]
    fn every_docker_file_ships_the_gate_and_the_extras() {
        for (name, df) in [
            ("server.linux", include_str!("../templates/docker/Dockerfile.server.linux.template")),
            ("server.windows", include_str!("../templates/docker/Dockerfile.server.windows.template")),
            ("linux", include_str!("../templates/docker/Dockerfile.linux.template")),
            ("windows", include_str!("../templates/docker/Dockerfile.windows.template")),
        ] {
            assert!(df.contains("COPY access-gate.js keyauth.mjs bmm-extras.js access.json server.config.json ./"), "{name}: the server would start without its gate");
            assert!(df.contains("/health'"), "{name}: health check");
        }
    }

    #[test]
    fn every_node_edition_loads_the_extras_and_hides_the_private_folder() {
        for (name, src) in [
            ("express", include_str!("../templates/mini-server/server.express.js.template")),
            ("v1.sh", include_str!("../templates/mini-server/server.hybrid.sh.template")),
            ("v1.bat", include_str!("../templates/mini-server/server.hybrid.bat.template")),
            ("v2.sh", include_str!("../templates/mini-server/server.v2.sh.template")),
            ("v2.bat", include_str!("../templates/mini-server/server.v2.bat.template")),
        ] {
            assert!(src.contains("require('./bmm-extras.js')"), "{name}: extras not loaded");
            assert!(src.contains("extras.early(") && src.contains("extras.serve(") && src.contains("extras.prepareFile("), "{name}: a hook is missing");
            assert!(src.contains("=== 'bmm-server'"), "{name}: bmm-server/ would be served");
            assert!(src.contains("extras.attach("), "{name}: jobs never start");
        }
    }
}
