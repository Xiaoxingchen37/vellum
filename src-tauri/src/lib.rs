//! Vellum desktop shell.
//!
//! The Rust layer is deliberately thin: it owns the window, locates a Python
//! interpreter, launches the FastAPI sidecar on a free loopback port, waits for
//! it to become healthy, and hands the base URL to the webview. All document
//! work happens in the Python process.

mod sidecar;

use std::sync::Mutex;

use sidecar::Sidecar;
use tauri::{Manager, RunEvent, State};

struct AppState {
    sidecar: Mutex<Option<Sidecar>>,
}

/// Return the loopback base URL of the running Python sidecar.
#[tauri::command]
fn backend_url(state: State<'_, AppState>) -> Result<String, String> {
    let guard = state.sidecar.lock().map_err(|_| "state poisoned")?;
    match guard.as_ref() {
        Some(sidecar) => Ok(sidecar.base_url()),
        None => Err("backend not started".into()),
    }
}

/// Report sidecar health plus the interpreter that was used, for the UI.
#[tauri::command]
fn backend_status(state: State<'_, AppState>) -> Result<sidecar::SidecarStatus, String> {
    let guard = state.sidecar.lock().map_err(|_| "state poisoned")?;
    match guard.as_ref() {
        Some(sidecar) => Ok(sidecar.status()),
        None => Err("backend not started".into()),
    }
}

/// Restart the sidecar, e.g. after the user changes the Python path.
#[tauri::command]
fn restart_backend(state: State<'_, AppState>) -> Result<String, String> {
    let mut guard = state.sidecar.lock().map_err(|_| "state poisoned")?;
    if let Some(mut old) = guard.take() {
        old.stop();
    }
    let started = Sidecar::start().map_err(|error| error.to_string())?;
    let url = started.base_url();
    *guard = Some(started);
    Ok(url)
}

pub fn run() {
    let sidecar = match Sidecar::start() {
        Ok(sidecar) => {
            log_line(&format!("sidecar ready at {}", sidecar.base_url()));
            Some(sidecar)
        }
        Err(error) => {
            log_line(&format!("sidecar failed to start: {error}"));
            None
        }
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        }))
        .manage(AppState {
            sidecar: Mutex::new(sidecar),
        })
        .invoke_handler(tauri::generate_handler![
            backend_url,
            backend_status,
            restart_backend
        ])
        .build(tauri::generate_context!())
        .expect("error while building Vellum")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    if let Ok(mut guard) = state.sidecar.lock() {
                        if let Some(mut sidecar) = guard.take() {
                            sidecar.stop();
                        }
                    }
                }
            }
        });
}

fn log_line(message: &str) {
    println!("[vellum] {message}");
    // Also append to a log file next to the library so a windowed launch (where
    // stdout goes nowhere) can still be diagnosed.
    if let Ok(base) = std::env::var("LOCALAPPDATA") {
        let path = std::path::PathBuf::from(base).join("Vellum").join("shell.log");
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
            use std::io::Write;
            let _ = writeln!(file, "[vellum] {message}");
        }
    }
}
