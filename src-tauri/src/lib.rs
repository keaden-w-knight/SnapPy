#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // shell: launches the user's local CPython (see native-backend.ts)
        .plugin(tauri_plugin_shell::init())
        // dialog + fs: native Open/Save for .snappy project files
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running SnapPy");
}
