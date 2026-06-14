//! bmm-bench-cli — a thin driver so `hyperfine` can measure whole-process,
//! end-to-end wall time (process startup + one real operation). This is the
//! number a user actually waits on, and it complements Criterion's steady-state
//! in-process measurements.
//!
//! Subcommands:
//!   gen-tree    <dir> <small|medium|large>   build a synthetic mod tree
//!   gen-archives <tree_dir> <out_dir>        build zip/tar/tar.gz/7z from a tree
//!   entries     <archive>                    list entries (no extract), print count
//!   extract     <archive> <dest>             extract archive to dest
//!   scan        <dir>                         jwalk scan, print file count
//!
//! Designed to exit non-zero on error so hyperfine flags failures.

use std::path::Path;
use std::process::ExitCode;

use bmm_benchmarks::{archive, fixtures, fs_mirror};
use bmm_benchmarks::fixtures::TreeSpec;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    match run(&args) {
        Ok(msg) => { if !msg.is_empty() { println!("{msg}"); } ExitCode::SUCCESS }
        Err(e) => { eprintln!("error: {e}"); ExitCode::FAILURE }
    }
}

fn run(args: &[String]) -> Result<String, String> {
    let cmd = args.get(1).map(|s| s.as_str()).unwrap_or("");
    match cmd {
        "gen-tree" => {
            let dir = arg(args, 2)?;
            let spec = match args.get(3).map(|s| s.as_str()).unwrap_or("medium") {
                "small" => TreeSpec::small(),
                "large" => TreeSpec::large(),
                _ => TreeSpec::medium(),
            };
            let files = fixtures::build_tree(Path::new(dir), spec).map_err(e2s)?;
            Ok(format!("wrote {} files ({} bytes) to {dir}", files.len(), fixtures::total_bytes(&files)))
        }
        "gen-archives" => {
            let tree = arg(args, 2)?;
            let out = arg(args, 3)?;
            std::fs::create_dir_all(out).map_err(e2s)?;
            let tree_p = Path::new(tree);
            let files = fs_mirror::scan_jwalk(tree_p)
                .into_iter().map(|rel| tree_p.join(rel)).collect::<Vec<_>>();
            let zip = Path::new(out).join("mod.zip");
            let tar = Path::new(out).join("mod.tar");
            let tgz = Path::new(out).join("mod.tar.gz");
            let svz = Path::new(out).join("mod.7z");
            fixtures::make_zip(tree_p, &files, &zip).map_err(e2s)?;
            fixtures::make_tar(tree_p, &tar).map_err(e2s)?;
            fixtures::make_tar_gz(tree_p, &tgz).map_err(e2s)?;
            let sevenz = match fixtures::make_7z(tree_p, &svz) { Ok(_) => "mod.7z", Err(_) => "(7z skipped)" };
            Ok(format!("built mod.zip, mod.tar, mod.tar.gz, {sevenz} in {out}"))
        }
        "entries" => {
            let a = arg(args, 2)?;
            let n = archive::archive_entries(Path::new(a)).map_err(e2s)?.len();
            Ok(format!("{n} entries"))
        }
        "extract" => {
            let a = arg(args, 2)?;
            let dest = arg(args, 3)?;
            archive::extract_to(Path::new(a), Path::new(dest)).map_err(e2s)?;
            Ok(String::new())
        }
        "scan" => {
            let d = arg(args, 2)?;
            let n = fs_mirror::scan_jwalk(Path::new(d)).len();
            Ok(format!("{n} files"))
        }
        "" => Err("missing subcommand (gen-tree|gen-archives|entries|extract|scan)".into()),
        other => Err(format!("unknown subcommand: {other}")),
    }
}

fn arg<'a>(args: &'a [String], i: usize) -> Result<&'a str, String> {
    args.get(i).map(|s| s.as_str()).ok_or_else(|| format!("missing argument #{}", i - 1))
}
fn e2s<E: std::fmt::Display>(e: E) -> String { e.to_string() }
