use chrono::Local;

fn main() {
    // #[cfg(target_os = "windows")]
    // embed_resource::compile("bmm.rc", std::iter::empty::<&str>());

    let date = Local::now().format("%Y-%m-%d").to_string();
    println!("cargo:rustc-env=BMM_BUILD_DATE={}", date);
    tauri_build::build()
}
