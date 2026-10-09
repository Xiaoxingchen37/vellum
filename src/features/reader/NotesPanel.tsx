import { useMemo, useState } from "react";
import { MessageSquare, X } from "lucide-react";
import type { Note } from "../../api/types";
import { renderMd } from "../../lib/markup";
import { plainText } from "../../lib/markup";
import type { RenderCtx } from "./blocks";

type Props = {
  ctx: RenderCtx;
  onClose: () => void;
  onJump: (anchor: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
};

/** All notes/highlights in document order, with a "pending questions" filter. */
export function NotesPanel({ ctx, onClose, onJump, onEdit, onDelete }: Props) {
  const [filter, setFilter] = useState<"all" | "question" | "note" | "highlight">("all");

  const order = useMemo(() => {
    const map = new Map<string, number>();
    (ctx.paper.blocks ?? []).forEach((b, i) => map.set(b.id, i));
    return map;
  }, [ctx.paper.blocks]);

  const notes = useMemo(() => {
    let list = Object.values(ctx.reader.notes ?? {}).filter((n) => !n.deleted);
    if (filter === "question") list = list.filter((n) => n.kind === "question");
    else if (filter === "note") list = list.filter((n) => n.kind === "note");
    else if (filter === "highlight") list = list.filter((n) => n.kind === "highlight");
    return list.sort((a, b) => (order.get(a.anchor ?? "") ?? 9999) - (order.get(b.anchor ?? "") ?? 9999));
  }, [ctx.reader.notes, filter, order]);

  const count = (kind: Note["kind"]) =>
    Object.values(ctx.reader.notes ?? {}).filter((n) => !n.deleted && n.kind === kind).length;

  return (
    <aside className="reader-notes-panel">
      <div className="pane-head">
        <b>笔记与划线</b>
        <button className="btn icon" onClick={onClose} title="关闭">
          <X size={15} />
        </button>
      </div>
      <div className="seg" style={{ margin: "10px 12px" }}>
        <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>
          全部
        </button>
        <button className={filter === "question" ? "on" : ""} onClick={() => setFilter("question")}>
          问题 {count("question") || ""}
        </button>
        <button className={filter === "note" ? "on" : ""} onClick={() => setFilter("note")}>
          笔记
        </button>
        <button className={filter === "highlight" ? "on" : ""} onClick={() => setFilter("highlight")}>
          划线
        </button>
      </div>
      <div className="reader-notes-scroll">
        {notes.length === 0 ? (
          <div className="empty" style={{ padding: 20, color: "var(--ink-3)", fontSize: 13 }}>
            还没有笔记。选中正文文字即可划线或写笔记。
          </div>
        ) : (
          notes.map((n) => (
            <div key={n.id} className={`card ${n.kind === "question" ? "q" : ""}`} style={{ position: "static", margin: "0 12px 12px" }}>
              <div className="lbl">
                <span>{n.kind === "question" ? "我的问题" : n.kind === "highlight" ? "我的划线" : "我的笔记"}</span>
                <button className="more" style={{ marginLeft: "auto" }} onClick={() => onEdit(n.id)}>
                  编辑
                </button>
                <button className="more" onClick={() => onDelete(n.id)}>
                  删除
                </button>
              </div>
              {n.quote && (
                <button className="quote" style={{ display: "block", textAlign: "left" }} onClick={() => onJump(n.anchor ?? "")} lang={n.side === "en" ? "en" : undefined}>
                  「{plainText(n.quote)}」
                </button>
              )}
              {n.body && <div className="body">{renderMd(n.body)}</div>}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
