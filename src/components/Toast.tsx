import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";

type ToastKind = "ok" | "err" | "info";
type Toast = { id: number; kind: ToastKind; text: string };

type ToastApi = {
  push: (text: string, kind?: ToastKind) => void;
};

const ToastContext = createContext<ToastApi>({ push: () => undefined });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((text: string, kind: ToastKind = "info") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, kind, text }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, kind === "err" ? 6000 : 3600);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.kind === "err" ? "err" : ""}`}>
            <Icon kind={toast.kind} />
            <span>{toast.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Icon({ kind }: { kind: ToastKind }) {
  const size = 15;
  if (kind === "ok") return <CheckCircle2 size={size} color="#51be94" />;
  if (kind === "err") return <AlertCircle size={size} color="#c75e69" />;
  return <Info size={size} color="#6d74df" />;
}
