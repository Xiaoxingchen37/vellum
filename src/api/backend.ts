/** Tauri bridge + typed client for the Vellum Python sidecar. */
import { invoke } from "@tauri-apps/api/core";

let cached: string | null = null;
let pending: Promise<string> | null = null;

const FALLBACK = "http://127.0.0.1:8765";

export type BackendStatus = {
  base_url: string;
  python: string;
  healthy: boolean;
  library_root?: string | null;
};

export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function backendUrl(): Promise<string> {
  if (cached) return cached;
  if (!inTauri()) {
    cached = FALLBACK;
    return cached;
  }
  if (!pending) {
    pending = invoke<string>("backend_url")
      .then((url) => {
        cached = url;
        return url;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

export async function backendStatus(): Promise<BackendStatus | null> {
  if (!inTauri()) return null;
  try {
    return await invoke<BackendStatus>("backend_status");
  } catch {
    return null;
  }
}

/** Upload a PDF's bytes to the sidecar. ``name`` is the original filename. */
export async function importPdf(
  bytes: Blob,
  name: string,
  opts: { translate: boolean; read?: boolean; model?: string; target?: string; scope?: string; token?: string } = {
    translate: true,
  },
): Promise<{ id: string; new: boolean; queued: boolean }> {
  const base = await backendUrl();
  const q = new URLSearchParams({
    name,
    translate: opts.translate ? "1" : "0",
    read: opts.read ? "1" : "0",
    model: opts.model ?? "",
    target: opts.target ?? "",
  });
  if (opts.scope) q.set("scope", opts.scope);
  const response = await fetch(`${base}/api/import?${q.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/pdf", "X-Token": opts.token ?? "" },
    body: bytes,
  });
  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.json())?.error ?? "";
    } catch {
      detail = await response.text().catch(() => "");
    }
    throw new Error(detail || `导入失败（HTTP ${response.status}）`);
  }
  return (await response.json()) as { id: string; new: boolean; queued: boolean };
}

/** Fetch a JSON endpoint from the sidecar. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await backendUrl();
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = body?.error ?? "";
    } catch {
      detail = await response.text().catch(() => "");
    }
    throw new Error(detail || `请求失败（HTTP ${response.status}）`);
  }
  return (await response.json()) as T;
}

/** Absolute URL for a paper artifact (source.pdf, pages/*.webp, figures/*.webp). */
export async function artifactUrl(projectId: string, rel: string): Promise<string> {
  const base = await backendUrl();
  const clean = rel.replace(/^\/+/, "");
  return `${base}/p/${encodeURIComponent(projectId)}/${clean.split("/").map(encodeURIComponent).join("/")}`;
}

export async function isDesktop(): Promise<boolean> {
  return inTauri();
}

/** Enter or leave true OS fullscreen. */
export async function setFullscreen(on: boolean): Promise<boolean> {
  if (!inTauri()) return false;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  await win.setFullscreen(on);
  return win.isFullscreen();
}

export async function onFullscreenChange(
  handler: (fullscreen: boolean) => void,
): Promise<() => void> {
  if (!inTauri()) return () => undefined;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  let last = false;
  void win.isFullscreen().then((value) => {
    last = value;
  });
  const { listen } = await import("@tauri-apps/api/event");
  return listen("tauri://resize", () => {
    void win.isFullscreen().then((current) => {
      if (current !== last) {
        last = current;
        handler(current);
      }
    });
  });
}
