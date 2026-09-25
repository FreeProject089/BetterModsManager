//! The Docker files written next to a generated standalone repo server.
//!
//! Shared by the app's exporter (`commands::repo`) and the MCP/CLI one (`mcp::state_bridge`),
//! which used to carry the same twenty lines each. std only, so the self-contained
//! `bmm-mcp-server` example can mount this file as it mounts `zipping.rs`.
//!
//! The admin password used to be written IN docker-compose.yml (`- ADMIN_PASSWORD=…`), the
//! one file of the set people paste into issues, share and commit. It now goes to `.env`
//! beside it, which the compose file names in `env_file:`; `.gitignore` and `.dockerignore`
//! entries keep that file out of git and out of the image's build context. On Unix the file
//! is readable by its owner only.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// What was written, for the caller's message.
pub struct DockerFiles {
    pub dockerfile: PathBuf,
    pub compose: PathBuf,
    pub env: PathBuf,
}

/// One `KEY=value` line for a compose `env_file`.
///
/// Compose interpolates `$` in unquoted and double-quoted values, and cuts an unquoted one at
/// ` #`, so a password is written single-quoted, which Compose reads literally. A password
/// that itself contains a single quote is double-quoted instead, with `\`, `"` and `$`
/// escaped. A line break cannot be represented at all and is refused.
pub fn env_line(key: &str, value: &str) -> io::Result<String> {
    if value.contains('\n') || value.contains('\r') {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "the admin password contains a line break"));
    }
    if !value.contains('\'') {
        return Ok(format!("{key}='{value}'\n"));
    }
    let esc = value.replace('\\', "\\\\").replace('"', "\\\"").replace('$', "$$");
    Ok(format!("{key}=\"{esc}\"\n"))
}

/// Add `line` to the ignore file at `path` unless it is already there, keeping what is in it.
fn ensure_line(path: &Path, header: &str, line: &str) -> io::Result<()> {
    let existing = fs::read_to_string(path).unwrap_or_default();
    if existing.lines().any(|l| l.trim() == line) {
        return Ok(());
    }
    let mut out = existing;
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(header);
    out.push_str(line);
    out.push('\n');
    fs::write(path, out)
}

/// Fill the two templates and write Dockerfile, docker-compose.yml, .env, and the .env lines
/// of .gitignore / .dockerignore into `out`.
pub fn write_docker_files(
    out: &Path,
    dockerfile_template: &str,
    compose_template: &str,
    port: u16,
    admin_password: &str,
) -> io::Result<DockerFiles> {
    let env_text = env_line("ADMIN_PASSWORD", admin_password)?;
    let port = port.to_string();

    let dockerfile = out.join("Dockerfile");
    fs::write(&dockerfile, dockerfile_template.replace("PORT_PLACEHOLDER", &port))?;

    let compose = out.join("docker-compose.yml");
    fs::write(&compose, compose_template.replace("PORT_PLACEHOLDER", &port))?;

    let env = out.join(".env");
    fs::write(
        &env,
        format!("# Read by docker-compose.yml (env_file). Keep this file private: it holds the admin password.\n{env_text}"),
    )?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&env, fs::Permissions::from_mode(0o600))?;
    }

    ensure_line(&out.join(".gitignore"), "# The admin password (docker-compose env_file), written by BMM\n", ".env")?;
    ensure_line(&out.join(".dockerignore"), "# Never send the admin password into the image\n", ".env")?;

    Ok(DockerFiles { dockerfile, compose, env })
}

#[cfg(test)]
mod tests {
    use super::*;

    const COMPOSES: [&str; 2] = [
        include_str!("../templates/docker/docker-compose.yml.template"),
        include_str!("../templates/docker/docker-compose.server.yml.template"),
    ];

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("bmm-docker-export-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn the_password_goes_to_env_and_never_into_the_compose_file() {
        for (i, tpl) in COMPOSES.iter().enumerate() {
            assert!(!tpl.contains("ADMIN_PASSWORD_PLACEHOLDER"), "compose template {i} still carries the password");
            assert!(tpl.contains("env_file:") && tpl.contains("- .env"), "compose template {i} does not read .env");
            let d = tmp(&format!("c{i}"));
            let w = write_docker_files(&d, "FROM x\nEXPOSE PORT_PLACEHOLDER\n", tpl, 8123, "S3cret-pw").unwrap();
            let compose = fs::read_to_string(&w.compose).unwrap();
            assert!(!compose.contains("S3cret-pw"), "the password is in docker-compose.yml");
            assert!(compose.contains("8123:8123"));
            assert!(fs::read_to_string(&w.env).unwrap().contains("ADMIN_PASSWORD='S3cret-pw'"));
            assert!(fs::read_to_string(&w.dockerfile).unwrap().contains("EXPOSE 8123"));
            assert!(fs::read_to_string(d.join(".gitignore")).unwrap().lines().any(|l| l == ".env"));
            assert!(fs::read_to_string(d.join(".dockerignore")).unwrap().lines().any(|l| l == ".env"));
            let _ = fs::remove_dir_all(&d);
        }
    }

    #[test]
    fn an_existing_gitignore_is_kept_and_not_duplicated() {
        let d = tmp("keep");
        fs::write(d.join(".gitignore"), "node_modules/\nserver.log").unwrap();
        for _ in 0..2 {
            write_docker_files(&d, "", COMPOSES[0], 1, "pw").unwrap();
        }
        let g = fs::read_to_string(d.join(".gitignore")).unwrap();
        assert!(g.starts_with("node_modules/\nserver.log\n"), "{g}");
        assert_eq!(g.lines().filter(|l| *l == ".env").count(), 1, "{g}");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn passwords_are_written_so_compose_reads_them_back_literally() {
        assert_eq!(env_line("K", "a$b #c").unwrap(), "K='a$b #c'\n");
        assert_eq!(env_line("K", "it's").unwrap(), "K=\"it's\"\n");
        assert_eq!(env_line("K", "a'$\"\\").unwrap(), "K=\"a'$$\\\"\\\\\"\n");
        assert!(env_line("K", "two\nlines").is_err());
        assert!(env_line("K", "cr\r").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn env_is_private_on_unix() {
        use std::os::unix::fs::PermissionsExt;
        let d = tmp("mode");
        let w = write_docker_files(&d, "", COMPOSES[0], 1, "pw").unwrap();
        assert_eq!(fs::metadata(&w.env).unwrap().permissions().mode() & 0o777, 0o600);
        let _ = fs::remove_dir_all(&d);
    }
}
