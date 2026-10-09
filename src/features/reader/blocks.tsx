import type { ReactNode } from "react";
import { renderTextWithMarks, type MarkRange } from "../../lib/markup";
import type { Block, BlockItem, Paper, ReaderState, SentenceAlign } from "../../api/types";
import { marksForKey } from "./anchors";

export type XrefIndexLike = {
  eq: Record<string, string>;
  tab: Record<string, string>;
  fig: Record<string, string>;
  sec: Record<string, string>;
};

export type RenderCtx = {
  paper: Paper;
  reader: ReaderState;
  refs: Set<string>;
  xrefs: XrefIndexLike;
  onCite: (n: string) => void;
  onXref: (kind: keyof XrefIndexLike, key: string, label: string) => void;
  onMarkClick?: (id: string) => void;
};

/** All editable keys a block contributes (matches backend field keys). */
export function blockKeys(block: Block): string[] {
  switch (block.type) {
    case "list":
      return (block.items ?? []).map((_, i) => `${block.id}#${i}`);
    case "table":
    case "figure":
      return [`${block.id}#caption`];
    case "math":
    case "references":
    case "note":
      return [];
    default:
      return [block.id];
  }
}

export function hasTranslation(block: Block): boolean {
  if (block.zh || block.caption_zh || block.image_zh) return true;
  return (block.items ?? []).some((it) => it.zh);
}

/** Resolve text for a key: user edit > agent translation > source English. */
export function textFor(ctx: RenderCtx, key: string): { text: string; isEn: boolean } {
  const [id, field] = key.split("#");
  const block = ctx.paper.blocks.find((b) => b.id === id);
  if (!block) return { text: "", isEn: false };
  const edit = ctx.reader.edits?.[key];
  const pick = (zh?: string, en?: string) => {
    if (edit?.zh != null) return { text: edit.zh, isEn: false };
    if (zh) return { text: zh, isEn: false };
    if (en) return { text: en, isEn: true };
    return { text: "", isEn: false };
  };
  if (field === "caption") return pick(block.caption_zh, block.caption_en);
  if (field === "image") return pick(block.image_zh, block.image_en);
  if (field != null && /^\d+$/.test(field)) {
    const it = (block.items ?? [])[Number(field)] ?? {};
    return pick(it.zh, it.en);
  }
  return pick(block.zh, block.en);
}

export function isEdited(ctx: RenderCtx, key: string): boolean {
  return !!ctx.reader.edits?.[key];
}

/** Sentence alignment still valid for a key's object, else null. */
export function alignOf(block: Block, key: string): SentenceAlign[] | null {
  const obj = alignedObject(block, key);
  const s = obj?.sents;
  const en = obj?.en ?? "";
  const zh = obj?.zh ?? "";
  if (!Array.isArray(s) || s.length < 2) return null;
  const last = s[s.length - 1];
  if (last[0] !== en.length || last[1] !== zh.length) return null;
  for (let i = 0; i < s.length; i++) {
    const prev = i ? s[i - 1] : [0, 0];
    if (!(s[i][0] > prev[0]) || !(s[i][1] > prev[1])) return null;
  }
  return s;
}

/** The object holding en/zh/sents for a key (block itself, or a list item). */
function alignedObject(block: Block, key: string): { sents?: SentenceAlign[]; en?: string; zh?: string } | undefined {
  const field = key.split("#")[1];
  if (block.type === "list" && field != null && /^\d+$/.test(field)) {
    return (block.items ?? [])[Number(field)] as BlockItem;
  }
  if (field == null) return block;
  return undefined;
}

/** Render text with highlights, optionally split into per-sentence spans. */
export function renderAligned(
  ctx: RenderCtx,
  block: Block,
  key: string,
  side: "en" | "zh",
  text: string,
): ReactNode {
  const all = marksForKey(ctx.reader, key, text);
  const marks: MarkRange[] = all
    .filter((t) => (side === "en" ? t.note.side === "en" : t.note.side !== "en"))
    .map((t) => ({
      start: t.start,
      end: t.end,
      color: t.note.color || "yellow",
      style: t.note.style,
      kind: t.note.kind,
      id: t.note.id,
    }));
  const opts = { refs: ctx.refs, onCite: ctx.onCite };
  const sents = alignOf(block, key);
  const edited = side === "zh" && isEdited(ctx, key);
  // Only split into sentences when the text we are rendering is exactly the
  // object the alignment was computed against (paragraph or list item).
  const obj = alignedObject(block, key);
  const expected = side === "en" ? obj?.en : obj?.zh;
  if (!sents || edited || text !== expected) {
    return <>{renderTextWithMarks(text, marks, opts, ctx.onMarkClick)}</>;
  }
  const col = side === "en" ? 0 : 1;
  const bounds: number[] = [0];
  for (const row of sents) bounds.push(row[col]);
  return (
    <>
      {bounds.slice(0, -1).map((start, i) => {
        const end = bounds[i + 1];
        const slice = text.slice(start, end);
        const lead = slice.match(/^\s*/)?.[0] ?? "";
        const sliceMarks = marks
          .filter((m) => m.start < end && m.end > start)
          .map((m) => ({ ...m, start: Math.max(0, m.start - start), end: Math.min(slice.length, m.end - start) }));
        return (
          <span key={i} className="snt" data-s={i}>
            {lead}
            {renderTextWithMarks(slice.slice(lead.length), sliceMarks.map((m) => ({ ...m, start: Math.max(0, m.start - lead.length), end: Math.max(0, m.end - lead.length) })), opts, ctx.onMarkClick)}
          </span>
        );
      })}
    </>
  );
}

export function blockClassName(block: Block): string {
  let c = `blk blk-${block.type}`;
  if (block.type === "heading") c += ` h${block.level || 1}${block.appendix ? " appendix" : ""}`;
  if (block.type === "references") c += " blk-heading h1";
  if (block.cont) c += " cont";
  if (block.role === "abstract") c += " abstract";
  return c;
}
