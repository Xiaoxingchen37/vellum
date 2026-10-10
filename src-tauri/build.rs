fn main() {
    // The frozen Python sidecar is produced separately (PyInstaller) and then
    // bundled as a resource. Its absence is fine for a dev build, but the
    // packaged MSI must ship it or the app has no backend.
    let sidecar = std::path::Path::new("binaries/vellum-sidecar.exe");
    if !sidecar.exists() {
        println!(
            "cargo:warning=binaries/vellum-sidecar.exe is missing; the packaged app will need a local Python. \
             Build it with: python build_sidecar.py"
        );
    }
    tauri_build::build()
}
