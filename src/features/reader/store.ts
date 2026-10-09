/** Reader state store: user edits/notes/progress go through an outbox queue that
 * is flushed to the sidecar's ``/ops`` endpoint. Ported from easyread's
 * store.js, but as a React hook. Server is the source of truth; the outbox is
 * re-applied optimistically so the UI never blocks on a round trip.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, backendUrl } from "../../api/backend";
import type { Note, ReaderState } from "../../api/types";

export type Op =
  | { op: "edit"; block: string; zh: string | null; base?: string; at?: string }
  | { op: "note"; note: Note; at?: string }
  | { op: "note_del"; id: string; at?: string }
  | { op: "paper_note"; body: string; at?: string }
  | { op: "progress"; block: string; ratio?: number; at?: string };

export type SaveStatus = "saved" | "saving" | "offline" | "error";

export function nowIso(): string {
  return new Date().toISOString();
}

/** Same merge rules as the Python ``store.apply_ops``. */
function applyOps(base: ReaderState, ops: Op[]): ReaderState {
  const reader: ReaderState = JSON.parse(JSON.stringify(base || {}));
  const edits = (reader.edits = reader.edits || {});
  const notes = (reader.notes = reader.notes || {});
  const progress = (reader.progress = reader.progress || {});
  for (const op of ops) {
    const at = op.at || nowIso();
    if (op.op === "edit") {
      const cur = edits[op.block];
      if (cur && (cur.at || "") > at) continue;
      if (op.zh == null) {
        if (cur) edits[op.block] = { reverted: true, prev: cur.zh, at };
      } else {
        const entry: NonNullable<ReaderState["edits"]>[string] = { zh: op.zh, base: op.base || "", at };
        if (cur?.zh && cur.zh !== op.zh) entry.prev = cur.zh;
        edits[op.block] = entry;
      }
    } else if (op.op === "note") {
      const cur = notes[op.note.id];
      if (cur && (cur.updated || "") > (op.note.updated || "")) continue;
      notes[op.note.id] = JSON.parse(JSON.stringify(op.note));
    } else if (op.op === "note_del") {
      const cur = notes[op.id];
      if (!cur || at >= (cur.updated || "")) {
        notes[op.id] = { ...(cur || { id: op.id }), deleted: true, updated: at };
      }
    } else if (op.op === "paper_note") {
      const cur = reader.paper_note || {};
      if (at >= (cur.at || "")) reader.paper_note = { body: op.body || "", at };
    } else if (op.op === "progress") {
      if (at >= (progress.at || "")) {
        reader.progress = { block: op.block, at, ...(op.ratio != null ? { ratio: op.ratio } : {}) };
      }
    }
  }
  return reader;
}

type StoreApi = {
  reader: ReaderState;
  status: SaveStatus;
  token: string;
  commit: (op: Op) => void;
  deleteNote: (id: string) => void;
  saveNote: (note: Note) => void;
};

export function useReaderStore(
  projectId: string,
  serverReader: ReaderState | undefined,
  token: string,
): StoreApi {
  const [outbox, setOutbox] = useState<Op[]>([]);
  const [status, setStatus] = useState<SaveStatus>("saved");
  // Local baseline: the server reader plus every op we have already flushed.
  // Without it, clearing the outbox after a successful save would briefly show
  // the stale server snapshot (notes/highlights would flash away) until the
  // next poll brings the new reader down.
  const [baseline, setBaseline] = useState<ReaderState>(serverReader || {});
  const flushing = useRef(false);
  const timer = useRef<number | null>(null);
  const outboxRef = useRef<Op[]>([]);
  const tokenRef = useRef(token);
  const clientId = useMemo(() => `c-${Math.random().toString(36).slice(2, 10)}`, []);

  outboxRef.current = outbox;
  tokenRef.current = token;

  // Adopt the authoritative server reader whenever a new snapshot arrives, but
  // only if nothing is still pending — otherwise keep the optimistic baseline.
  useEffect(() => {
    if (!outboxRef.current.length) setBaseline(serverReader || {});
  }, [serverReader]);

  const flush = useCallback(async () => {
    if (flushing.current || !outboxRef.current.length) return;
    flushing.current = true;
    const batch = outboxRef.current.slice();
    try {
      const base = await backendUrl();
      const response = await fetch(`${base}/api/p/${encodeURIComponent(projectId)}/ops`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Token": tokenRef.current },
        body: JSON.stringify({ ops: batch, client: clientId }),
      });
      if (!response.ok) throw new Error(String(response.status));
      // Fold the flushed ops into the baseline so the UI stays stable.
      setBaseline((cur) => applyOps(cur, batch));
      setOutbox((cur) => {
        const next = cur.filter((o) => !batch.includes(o));
        setStatus(next.length ? "saving" : "saved");
        return next;
      });
    } catch {
      setStatus("offline");
      window.setTimeout(() => void flush(), 2000);
    } finally {
      flushing.current = false;
    }
  }, [projectId, clientId]);

  const schedule = useCallback(
    (delay: number) => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), delay);
    },
    [flush],
  );

  const commit = useCallback(
    (op: Op) => {
      const withAt = { ...op, at: op.at || nowIso() } as Op;
      setOutbox((cur) => {
        let next = cur;
        if (op.op === "note") next = cur.filter((o) => !(o.op === "note" && o.note.id === op.note.id));
        if (op.op === "edit") next = cur.filter((o) => !(o.op === "edit" && o.block === op.block));
        if (op.op === "progress" || op.op === "paper_note") next = cur.filter((o) => o.op !== op.op);
        return [...next, withAt];
      });
      setStatus("saving");
      schedule(op.op === "progress" ? 3000 : 250);
    },
    [schedule],
  );

  const saveNote = useCallback(
    (note: Note) => commit({ op: "note", note: { ...note, updated: nowIso() } }),
    [commit],
  );

  const deleteNote = useCallback((id: string) => commit({ op: "note_del", id }), [commit]);

  const reader = useMemo(() => applyOps(baseline, outbox), [baseline, outbox]);

  // Flush any pending ops on unmount so nothing is lost when leaving the page.
  useEffect(() => {
    return () => {
      if (outboxRef.current.some((o) => o.op !== "progress")) void flush();
    };
  }, [flush]);

  return { reader, status, token: tokenRef.current, commit, deleteNote, saveNote };
}
