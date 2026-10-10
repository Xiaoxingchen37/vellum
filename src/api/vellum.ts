/** Typed calls against the Vellum Python sidecar. */
import { invoke } from "@tauri-apps/api/core";
import { api, backendUrl, inTauri } from "./backend";
import type {
  ChatModelsResponse,
  ConfigResponse,
  EnginesResponse,
  LibraryLocation,
  PaperSummary,
  ReaderPayload,
} from "./types";

/** The library list + session token + global status. */
export type LibraryResponse = {
  items: PaperSummary[];
  token: string;
  jobs: { id: string; kind: string; pid: string; state: string; message: string }[];
  library_status: string;
  engine: string;
  engine_label: string;
  first_run: boolean;
  version: string;
  trash: number;
};

export function getLibrary(): Promise<LibraryResponse> {
  return api<LibraryResponse>("/api/library");
}

export function getState(id: string): Promise<ReaderPayload> {
  return api<ReaderPayload>(`/api/p/${encodeURIComponent(id)}/state`);
}

/** Fetch only the versions of a paper's files, for cheap change polling. */
export function getVersions(
  id: string,
): Promise<Record<string, string> & { library_status: string }> {
  return api(`/api/p/${encodeURIComponent(id)}/versions`);
}

export function getEngines(fresh = false): Promise<EnginesResponse> {
  return api<EnginesResponse>(`/api/engines${fresh ? "?fresh=1" : ""}`);
}

export function getConfig(): Promise<ConfigResponse> {
  return api<ConfigResponse>("/api/config");
}

/** Where the library lives now, and what other libraries were detected. */
export function getLibraryLocation(): Promise<LibraryLocation> {
  return api<LibraryLocation>("/api/library/location");
}

/** Ask the backend to pop the native "pick a folder" dialog. */
export function pickFolder(title: string): Promise<{ supported: boolean; path: string }> {
  return api<{ supported: boolean; path: string }>("/api/library/pick-folder", {
    method: "POST",
    headers: { "X-Token": sessionToken },
    body: JSON.stringify({ title }),
  });
}

/**
 * Move the library to another folder. `mode` mirrors the backend: "copy" copies
 * the current library there, "use" points at an existing library, "merge" merges.
 * Takes effect after a restart.
 */
export function moveLibrary(
  path: string,
  mode: "copy" | "use" | "merge" = "copy",
): Promise<{ ok: boolean; path: string; copied?: number; message?: string; restart_required?: boolean }> {
  return api("/api/library/move", {
    method: "POST",
    headers: { "X-Token": sessionToken },
    body: JSON.stringify({ path, mode }),
  });
}

/** Restart the sidecar (used after changing the library location). */
export async function restartBackend(): Promise<void> {
  if (!inTauri()) throw new Error("只有在桌面版里才能自动重启");
  await invoke("restart_backend");
}

export function getChatModels(): Promise<ChatModelsResponse> {
  return api<ChatModelsResponse>("/api/chat/models");
}

/** Queue a translation / re-translation for a paper. */
export function translatePaper(
  id: string,
  body: {
    pages?: number[] | string | null;
    scope?: string;
    read?: boolean;
    failed?: boolean;
    en?: boolean;
    confirmed?: boolean;
    model?: string;
  },
): Promise<{ ok: boolean }> {
  return post(id, "translate", body);
}

export function cancelPaper(id: string): Promise<{ ok: boolean }> {
  return post(id, "cancel", {});
}

export function deletePaper(id: string): Promise<{ trash: string }> {
  return post(id, "delete", {});
}

export function patchItem(
  id: string,
  fields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return post(id, "item", fields);
}

/** Persist reader operations (edits, notes, progress) in one batch. */
export function applyOps(
  id: string,
  ops: Record<string, unknown>[],
  client = "react",
): Promise<{ rev: number; applied: string[]; versions: Record<string, string> }> {
  return post(id, "ops", { ops, client });
}

export function retranslate(
  id: string,
  key: string,
  hint = "",
): Promise<{ id: string }> {
  return post(id, "retranslate", { key, hint });
}

export type ChatThread = {
  id: string;
  title: string;
  model?: string;
  answer_style?: string;
  created?: string;
  updated?: string;
  messages: {
    id?: string;
    role: "user" | "assistant";
    content: string;
    anchor?: string;
    quote?: string;
    note?: string;
    model?: string;
    at?: string;
    usage?: Record<string, number>;
  }[];
};

export type ChatIndex = {
  threads: ChatThread[];
  models: import("./types").ChatModelEntry[];
  default: string;
  translate: string;
  limits?: unknown;
};

export function getChat(id: string): Promise<ChatIndex> {
  return api<ChatIndex>(`/api/p/${encodeURIComponent(id)}/chat`);
}

/** Stream one chat answer; calls ``onPiece`` for each text chunk. */
export async function streamChat(
  id: string,
  body: {
    text: string;
    thread?: string;
    model?: string;
    anchor?: string;
    quote?: string;
    refs?: { anchor: string; quote?: string }[];
    note?: string;
  },
  token: string,
  onPiece: (text: string) => void,
  signal?: AbortSignal,
): Promise<{ thread: string; id?: string }> {
  const base = await backendUrl();
  const response = await fetch(`${base}/api/p/${encodeURIComponent(id)}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Token": token },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error((await response.text().catch(() => "")) || `聊天失败（HTTP ${response.status}）`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let thread = body.thread ?? "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let ev: { t?: string; done?: boolean; id?: string; thread?: string; model?: string; error?: string };
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (ev.thread) thread = ev.thread;
      if (ev.error) throw new Error(ev.error);
      if (ev.t) onPiece(ev.t);
      if (ev.done) return { thread, id: ev.id };
    }
  }
  return { thread };
}

export function deleteChatThread(id: string, thread: string): Promise<unknown> {
  return post(id, "chat/delete", { thread });
}

/** The session token issued by the sidecar; required on every POST. */
let sessionToken = "";

export function setSessionToken(token: string): void {
  sessionToken = token || "";
}

export function getSessionToken(): string {
  return sessionToken;
}

function post<T>(id: string, action: string, body: unknown): Promise<T> {
  return api<T>(`/api/p/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    headers: { "X-Token": sessionToken },
    body: JSON.stringify(body),
  });
}

/** Save a config patch (engine, model, page cap, target language). */
export function saveConfig(patch: Record<string, unknown>): Promise<ConfigResponse> {
  return api<ConfigResponse>("/api/config", {
    method: "POST",
    headers: { "X-Token": sessionToken },
    body: JSON.stringify(patch),
  });
}

export function saveChatModels(body: Record<string, unknown>): Promise<ChatModelsResponse> {
  return api<ChatModelsResponse>("/api/chat/models", {
    method: "POST",
    headers: { "X-Token": sessionToken },
    body: JSON.stringify(body),
  });
}

export function testEngine(engine: string): Promise<{ ok: boolean; message: string }> {
  return api<{ ok: boolean; message: string }>("/api/config/test", {
    method: "POST",
    headers: { "X-Token": sessionToken },
    body: JSON.stringify({ engine }),
  });
}

/** Ask the provider's /models endpoint what it serves (settings "获取模型列表"). */
export function listModels(body: {
  base_url: string;
  preset?: string;
  api_key?: string;
}): Promise<{ ok: boolean; models?: string[]; message?: string }> {
  return api<{ ok: boolean; models?: string[]; message?: string }>("/api/models/list", {
    method: "POST",
    headers: { "X-Token": sessionToken },
    body: JSON.stringify(body),
  });
}

export async function artifactUrl(id: string, rel: string): Promise<string> {
  const base = await backendUrl();
  const clean = rel.replace(/^\/+/, "");
  const encoded = clean.split("/").map(encodeURIComponent).join("/");
  return `${base}/p/${encodeURIComponent(id)}/${encoded}`;
}

export function sourcePdfUrl(id: string): Promise<string> {
  return artifactUrl(id, "source.pdf");
}

/** Download a self-contained offline HTML reader for one paper. */
export async function exportPaper(id: string, mobile = false): Promise<void> {
  const base = await backendUrl();
  const response = await fetch(
    `${base}/api/p/${encodeURIComponent(id)}/export${mobile ? "?mobile=1" : ""}`,
    { headers: { "X-Token": sessionToken } },
  );
  if (!response.ok) throw new Error(`导出失败（HTTP ${response.status}）`);
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition) ?? /filename="([^"]+)"/i.exec(disposition);
  const name = match ? decodeURIComponent(match[1]) : `vellum-${id}.html`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
