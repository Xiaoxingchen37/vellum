import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { Note } from "../../api/types";

type Props = {
  note: Note;
  onSave: (patch: Partial<Note>) => void;
  onDelete: () => void;
  onClose: () => void;
};

const COLORS = ["yellow", "green", "blue", "pink"] as const;
const COLOR_NAMES: Record<string, string> = { yellow: "黄", green: "绿", blue: "蓝", pink: "红" };

export function NoteEditor({ note, onSave, onDelete, onClose }: Props) {
  const [body, setBody] = useState(note.body ?? "");
  const [kind, setKind] = useState<Note["kind"]>(note.kind ?? "note");
  const [color, setColor] = useState(note.color ?? "yellow");

  const save = () => {
    const trimmed = body.trim();
    if (!trimmed && kind !== "highlight") {
      if (note.quote) onSave({ body: "", kind: "highlight" });
      else onDelete();
      return;
    }
    onSave({ body: trimmed, kind, color });
  };

  return (
    <div className="dialog-backdrop open" onClick={onClose}>
      <div className="dialog" role="dialog" style={{ width: "min(520px, 92vw)" }} onClick={(e) => e.stopPropagation()}>
        <h2>{note.kind === "question" ? "问题" : note.kind === "highlight" ? "划线" : "笔记"}</h2>
        {note.quote && (
          <div className="card mine" style={{ position: "static", paddingLeft: 10, marginBottom: 12 }}>
            <div className="quote" lang={note.side === "en" ? "en" : undefined}>
              「{note.quote}」
            </div>
          </div>
        )}
        <label className="field">
          <span>内容（支持 $公式$、**粗体**）</span>
          <textarea className="input" rows={6} value={body} onChange={(e) => setBody(e.target.value)} autoFocus />
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="seg">
            <button className={kind === "note" ? "on" : ""} onClick={() => setKind("note")}>
              笔记
            </button>
            <button className={kind === "question" ? "on" : ""} onClick={() => setKind("question")}>
              问题
            </button>
          </span>
          {note.quote && (
            <span className="dots">
              {COLORS.map((c) => (
                <button
                  key={c}
                  className={`dot-${c}${color === c ? " on" : ""}`}
                  title={`${COLOR_NAMES[c]}色`}
                  onClick={() => setColor(c)}
                />
              ))}
            </span>
          )}
        </div>
        <div className="actions">
          <button className="btn line danger" onClick={onDelete} title="删除">
            <Trash2 size={14} /> 删除
          </button>
          <span className="grow" style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn accent" onClick={save}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
