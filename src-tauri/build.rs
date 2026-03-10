use chrono::Local;

fn main() {
    let date = Local::now().format("%Y-%m-%d").to_string();
    println!("cargo:rustc-env=BMM_BUILD_DATE={}", date);
    tauri_build::build()
}
