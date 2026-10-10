//! Python sidecar lifecycle management.
//!
//! Finds a suitable interpreter (an explicit override, a project virtualenv, or
//! a `conda run` fallback), picks a free loopback port, launches
//! `python -m vellum serve --port <port>`, then polls `/health` until it
//! answers. On shutdown the child process tree is killed.

use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

/// Environment variable that overrides interpreter discovery.
pub const PYTHON_ENV_VAR: &str = "VELLUM_PYTHON";
/// Conda environments to try, in order, when discovering a Python interpreter.
const CONDA_ENV_CANDIDATES: [&str; 2] = ["vellum", "CherryAgent"];
const STARTUP_TIMEOUT: Duration = Duration::from_secs(60);
const HEALTH_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, thiserror::Error)]
pub enum SidecarError {
    #[error("could not find a Python interpreter (set {PYTHON_ENV_VAR})")]
    NoInterpreter,
    #[error("no free loopback port available")]
    NoPort,
    #[error("failed to launch sidecar: {0}")]
    Launch(String),
    #[error("sidecar did not become healthy in time: {0}")]
    Unhealthy(String),
}

#[derive(Clone, Serialize)]
pub struct SidecarStatus {
    pub base_url: String,
    pub python: String,
    pub healthy: bool,
    pub library_root: Option<String>,
}

pub struct Sidecar {
    child: Option<Child>,
    port: u16,
    python: PathBuf,
}

/// How the sidecar is being run, for the status the UI shows.
#[derive(Clone, Copy, PartialEq)]
enum Launcher {
    /// A packaged `vellum-sidecar.exe` next to the app (no Python needed).
    Frozen,
    /// An interpreter running `-m vellum` (development).
    Interpreter,
}

impl Sidecar {
    /// Locate an interpreter, reserve a port and start the sidecar.
    pub fn start() -> Result<Self, SidecarError> {
        let (program, launcher) = match frozen_sidecar() {
            Some(exe) => (exe, Launcher::Frozen),
            None => (discover_python()?, Launcher::Interpreter),
        };
        let port = pick_port()?;

        // Frozen build: `vellum-sidecar.exe serve --port N`.
        // Dev build: `python -m vellum serve --port N` with the package on PYTHONPATH.
        let mut command = Command::new(&program);
        if launcher == Launcher::Interpreter {
            command.arg("-m").arg("vellum");
        }
        command.arg("serve").arg("--port").arg(port.to_string());
        if launcher == Launcher::Interpreter {
            if let Some(root) = find_python_package_root() {
                command.env("PYTHONPATH", root);
            }
        }
        // Config and logs live beside the data directory. The library location
        // itself is NOT forced here: it comes from config.json (the user can
        // change it in Settings), and VELLUM_LIBRARY remains an explicit
        // override for portable installs and tests.
        if let Some(home) = default_home_root() {
            command.env("VELLUM_HOME", home);
        }
        command
            .env("PYTHONIOENCODING", "utf-8")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = command
            .spawn()
            .map_err(|error| SidecarError::Launch(error.to_string()))?;

        // Drain the child's output on background threads. A windowed build has no
        // console, so `inherit` would leave the Python process with invalid
        // stdout/stderr handles and it would die on its first print. Piping and
        // writing to shell.log keeps it alive and gives us a real log.
        if let Some(out) = child.stdout.take() {
            spawn_log_pump(out, "out");
        }
        if let Some(err) = child.stderr.take() {
            spawn_log_pump(err, "err");
        }

        let mut sidecar = Sidecar {
            child: Some(child),
            port,
            python: program,
        };

        sidecar.wait_until_healthy()?;
        Ok(sidecar)
    }

    pub fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    pub fn status(&self) -> SidecarStatus {
        SidecarStatus {
            base_url: self.base_url(),
            python: self.python.display().to_string(),
            healthy: self.health_ok(),
            // The data directory is a user setting now; report the override
            // only when one is actually in force.
            library_root: std::env::var("VELLUM_LIBRARY").ok(),
        }
    }

    /// Poll the health endpoint until it responds or the deadline passes.
    fn wait_until_healthy(&mut self) -> Result<(), SidecarError> {
        let deadline = Instant::now() + STARTUP_TIMEOUT;
        let addr = format!("127.0.0.1:{}", self.port);
        while Instant::now() < deadline {
            if let Some(child) = self.child.as_mut() {
                if let Ok(Some(exit)) = child.try_wait() {
                    return Err(SidecarError::Launch(format!(
                        "sidecar exited early with status {exit}"
                    )));
                }
            }
            if health_probe(&addr) {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(400));
        }
        Err(SidecarError::Unhealthy(addr))
    }

    fn health_ok(&self) -> bool {
        health_probe(&format!("127.0.0.1:{}", self.port))
    }

    /// Terminate the sidecar and its children.
    pub fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            #[cfg(windows)]
            {
                let _ = Command::new("taskkill")
                    .args(["/PID", &child.id().to_string(), "/T", "/F"])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        self.stop();
    }
}

// ---------------------------------------------------------------------------
// discovery helpers
// ---------------------------------------------------------------------------

fn discover_python() -> Result<PathBuf, SidecarError> {
    if let Ok(explicit) = std::env::var(PYTHON_ENV_VAR) {
        let path = PathBuf::from(explicit);
        if path.exists() {
            return Ok(path);
        }
    }

    // A virtualenv placed beside the app (optional portable install).
    if let Ok(exe_dir) = std::env::current_exe() {
        if let Some(dir) = exe_dir.parent() {
            for candidate in [
                dir.join("python").join("python.exe"),
                dir.join("python").join("bin").join("python"),
            ] {
                if candidate.exists() {
                    return Ok(candidate);
                }
            }
        }
    }

    // Known local conda environments used during development.
    for root in [
        r"E:\miniforge3",
        r"C:\Users\Lenovo\miniforge3",
        r"C:\ProgramData\miniforge3",
    ] {
        for env_name in CONDA_ENV_CANDIDATES {
            let candidate = Path::new(root)
                .join("envs")
                .join(env_name)
                .join("python.exe");
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    // Last resort: a `python` on PATH.
    for name in ["python.exe", "python3", "python"] {
        if let Ok(path) = which(name) {
            return Ok(path);
        }
    }

    Err(SidecarError::NoInterpreter)
}

/// A packaged sidecar shipped next to the executable. Preferred over a Python
/// interpreter so an installed build runs with no Python on the machine.
///
/// A `VELLUM_SIDECAR` override wins (useful for testing a specific build).
fn frozen_sidecar() -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var("VELLUM_SIDECAR") {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Some(path);
        }
    }
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    // Tauri puts bundled resources in different places per platform; check the
    // layout the Windows MSI produces plus the dev tree.
    for candidate in [
        exe_dir.join("vellum-sidecar.exe"),
        exe_dir.join("binaries").join("vellum-sidecar.exe"),
        exe_dir.join("resources").join("vellum-sidecar.exe"),
    ] {
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn which(name: &str) -> Result<PathBuf, ()> {
    let Ok(path_var) = std::env::var("PATH") else {
        return Err(());
    };
    let separator = if cfg!(windows) { ';' } else { ':' };
    for dir in path_var.split(separator) {
        if dir.is_empty() {
            continue;
        }
        let candidate = Path::new(dir).join(name);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err(())
}

fn pick_port() -> Result<u16, SidecarError> {
    TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|listener| listener.local_addr().ok())
        .map(|addr| addr.port())
        .ok_or(SidecarError::NoPort)
}

/// Walk up from the executable to find the directory holding the `vellum`
/// Python package, so a dev build can run straight from the source tree.
fn find_python_package_root() -> Option<PathBuf> {
    // Try the current working directory first (dev runs from the project root),
    // then the executable's own location (a release build lives under
    // src-tauri/target/release, still inside the repo).
    let mut starts: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        starts.push(cwd);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            starts.push(dir.to_path_buf());
        }
    }
    for start in starts {
        let mut dir = start;
        for _ in 0..8 {
            let candidate = dir.join("python");
            if candidate.join("vellum").join("__init__.py").exists() {
                return Some(candidate);
            }
            if !dir.pop() {
                break;
            }
        }
    }
    None
}

/// Where the Python side keeps config.json and logs. Defaults to the parent of
/// the data directory (``%LOCALAPPDATA%\Vellum``).
fn default_home_root() -> Option<String> {
    if let Ok(explicit) = std::env::var("VELLUM_HOME") {
        return Some(explicit);
    }
    let base = std::env::var("LOCALAPPDATA").ok()?;
    Some(format!("{base}\\Vellum"))
}

/// Forward a child stream to the shell log on a background thread.
fn spawn_log_pump<R: std::io::Read + Send + 'static>(reader: R, tag: &'static str) {
    std::thread::spawn(move || {
        use std::io::{BufRead, BufReader, Write};
        let mut reader = BufReader::new(reader);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            let text = line.trim_end();
            if text.is_empty() {
                continue;
            }
            if let Ok(base) = std::env::var("LOCALAPPDATA") {
                let path = Path::new(&base).join("Vellum").join("shell.log");
                let _ = std::fs::create_dir_all(path.parent().unwrap_or(Path::new(".")));
                if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
                    let _ = writeln!(file, "[sidecar:{tag}] {text}");
                }
            }
        }
    });
}

/// One-shot HTTP/1.1 check against `{addr}/health`, e.g. `127.0.0.1:8765`.
fn health_probe(addr: &str) -> bool {
    use std::io::{Read, Write};

    let Ok(socket) = addr.parse::<std::net::SocketAddr>() else {
        return false;
    };
    let Ok(mut stream) = std::net::TcpStream::connect_timeout(&socket, HEALTH_TIMEOUT) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(HEALTH_TIMEOUT));
    let request =
        format!("GET /health HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut buffer = [0u8; 128];
    match stream.read(&mut buffer) {
        Ok(n) if n > 0 => String::from_utf8_lossy(&buffer[..n]).contains("200"),
        _ => false,
    }
}
