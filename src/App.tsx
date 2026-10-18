import { useEffect, useState } from "react";
import { getConfig } from "./api/vellum";
import { backendStatus, onFullscreenChange, setFullscreen, type BackendStatus } from "./api/backend";
import { useTheme } from "./api/theme";
import { loadPrefs, savePrefs, type Prefs } from "./api/types";
import { ToastProvider, useToast } from "./components/Toast";
import { LibraryPage } from "./features/library/LibraryPage";
import { ReaderPage } from "./features/reader/ReaderPage";
import { SettingsDialog } from "./features/settings/SettingsDialog";

type View = { page: "library" } | { page: "reader"; id: string };

function App() {
  const [view, setView] = useState<View>({ page: "library" });
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [engineLabel, setEngineLabel] = useState("");
  const [settingsRev, setSettingsRev] = useState(0);
  const { push } = useToast();

  useTheme(prefs.theme);

  useEffect(() => savePrefs(prefs), [prefs]);

  useEffect(() => {
    let alive = true;
    backendStatus().then((next) => {
      if (alive) setStatus(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  const refreshEngine = () => {
    getConfig()
      .then((c) => {
        // The backend already formats this (e.g. "DeepSeek · deepseek-flash").
        setEngineLabel(c.engine_label || c.config.engine);
      })
      .catch(() => setEngineLabel(""));
  };

  const handleSaved = () => {
    refreshEngine();
    setSettingsRev((r) => r + 1);
  };

  useEffect(() => {
    refreshEngine();
  }, []);

  // Escape leaves OS fullscreen (the close button is gone there).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        void setFullscreen(false).catch(() => undefined);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let disposed = false;
    let off: (() => void) | null = null;
    onFullscreenChange(() => undefined).then((fn) => {
      if (disposed) fn();
      else off = fn;
    });
    return () => {
      disposed = true;
      off?.();
    };
  }, []);

  const openReader = (id: string) => {
    setView({ page: "reader", id });
    push("已打开对照阅读", "ok");
  };

  return (
    <div className="app-shell">
      {view.page === "library" ? (
        <LibraryPage
          engineLabel={engineLabel}
          onOpenReader={openReader}
          onOpenSettings={() => setSettingsOpen(true)}
          settingsRev={settingsRev}
        />
      ) : (
        <ReaderPage
          projectId={view.id}
          onBack={() => setView({ page: "library" })}
          engineLabel={engineLabel}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          onSaved={handleSaved}
        />
      )}
      {status && !status.healthy ? (
        <div className="toast-stack">
          <div className="toast err">翻译服务未就绪：{status.base_url}</div>
        </div>
      ) : null}
    </div>
  );
}

export default function Root() {
  return (
    <ToastProvider>
      <App />
    </ToastProvider>
  );
}
