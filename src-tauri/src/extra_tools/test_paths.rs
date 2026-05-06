fn main() {
    let mp = std::path::PathBuf::from("C:\\");
    let temp = std::env::temp_dir();
    
    println!("mp: {:?}", mp.to_string_lossy());
    println!("temp: {:?}", temp.to_string_lossy());
    
    let dir_str = temp.to_string_lossy().to_string().to_lowercase();
    let mp_str = mp.to_string_lossy().to_string().to_lowercase();
    
    println!("dir_str: {}", dir_str);
    println!("mp_str: {}", mp_str);
    println!("starts_with: {}", dir_str.starts_with(&mp_str));
}
