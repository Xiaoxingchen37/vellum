/**
 * The reading experience.
 *
 * Rather than a hand-rolled second reader, Vellum embeds the reader that ships
 * with its own Python sidecar (`/read/<id>?embed=1`) — the same layout, margin
 * notes, PDF page panel, draggable panel widths, shortcuts, selection tools and
 * dark mode. The sidecar is served on a random loopback port chosen at launch,
 * so the URL has to be resolved at runtime via the Tauri `backend_url` command.
 *
 * `?embed=1` keeps that whole interface and only redirects its own back button
 * to a `vellum:back` message, so the shell (not the iframe) returns to the
 * library. Everything else stays intact.
 */
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { backendUrl } from "../../api/backend";
import { useToast } from "../../components/Toast";

type Props = {
  projectId: string;
  onBack: () => void;
  engineLabel: string;
};

export function ReaderPage({ projectId, onBack }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { push } = useToast();

  const resolve = useCallback(async () => {
    try {
      const base = await backendUrl();
      setSrc(`${base}/read/${encodeURIComponent(projectId)}?embed=1`);
      setError(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : "无法连接阅读服务";
      setError(message);
      push(message, "err");
    }
  }, [projectId, push]);

  useEffect(() => {
    void resolve();
  }, [resolve]);

  // The embedded reader asks the shell to go back when its back button is used.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type === "vellum:back") onBack();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onBack]);

  const openExternal = () => {
    if (src) window.open(src.replace("embed=1", "embed=0"), "_blank", "noopener");
  };

  return (
    <div className="reader-embed">
      {error ? (
        <div className="reader-empty">
          <p>{error}</p>
          <button className="btn line" onClick={() => void resolve()}>
            重试
          </button>
        </div>
      ) : src ? (
        <>
          <iframe className="reader-embed-frame" src={src} title="对照阅读" />
          <button className="reader-embed-open" onClick={openExternal} title="在浏览器中打开">
            <ExternalLink size={15} />
          </button>
        </>
      ) : (
        <div className="app-loading">
          <Loader2 size={22} className="spin" />
          <span>正在打开论文…</span>
        </div>
      )}
    </div>
  );
}
