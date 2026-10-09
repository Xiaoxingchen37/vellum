/** Text selection → highlight/note toolbar, and anchor extraction.
 * Mirrors easyread's anchor.js: a selection inside a keyed text element becomes
 * {anchor, key, quote, prefix, suffix, side}, stored as a reader note. */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type PendingSelection = {
  anchor: string;
  key: string;
  quote: string;
  prefix: string;
  suffix: string;
  side?: "en" | "zh";
  rect: { left: number; top: number; bottom: number; width: number };
};

const SKIP = ".katex-mathml, .stale-tag, button, .en-title, .num, .pgmark";

function textNodes(root: Node): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement && n.parentElement.closest(SKIP)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

function fullText(root: Node): string {
  return textNodes(root).map((t) => t.data).join("");
}

function offsetOf(root: Node, container: Node, offset: number): number {
  let pos = 0;
  for (const t of textNodes(root)) {
    if (t === container) return pos + offset;
    const r = document.createRange();
    r.selectNodeContents(t);
    if (r.comparePoint(container as Node, offset) < 0) return pos;
    pos += t.data.length;
  }
  return pos;
}

/** Read the current selection if it lies inside a keyed `.zh`/`.en` element. */
export function readSelection(root: HTMLElement): PendingSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const startEl =
    range.startContainer.nodeType === 1
      ? (range.startContainer as Element)
      : range.startContainer.parentElement;
  const el = startEl?.closest(".zh[data-key], .en") as HTMLElement | null;
  if (!el || !root.contains(el)) return null;
  const zh = el.classList.contains("zh") ? el : el.parentElement?.querySelector<HTMLElement>(".zh[data-key]");
  const keyEl = el.classList.contains("zh") ? el : zh;
  if (!keyEl?.dataset.key) return null;
  const blk = el.closest(".blk") as HTMLElement | null;
  if (!blk?.dataset.id) return null;
  const text = fullText(el);
  const s = el.contains(range.startContainer) ? offsetOf(el, range.startContainer, range.startOffset) : 0;
  const e = el.contains(range.endContainer) ? offsetOf(el, range.endContainer, range.endOffset) : text.length;
  const quote = text.slice(s, e);
  if (!quote.trim()) return null;
  const rect = range.getBoundingClientRect();
  return {
    anchor: blk.dataset.id,
    key: keyEl.dataset.key,
    quote,
    prefix: text.slice(Math.max(0, s - 32), s),
    suffix: text.slice(e, e + 32),
    side: el.classList.contains("en") ? "en" : undefined,
    rect: { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width },
  };
}

type ToolbarProps = {
  pending: PendingSelection | null;
  onHighlight: (color: string, style: "marker" | "underline") => void;
  onNote: () => void;
  onCopy: () => void;
  onAskAi: () => void;
  onDismiss: () => void;
};

const COLORS = ["yellow", "green", "blue", "pink"] as const;
const COLOR_NAMES: Record<string, string> = { yellow: "黄", green: "绿", blue: "蓝", pink: "红" };

export function SelectionToolbar({ pending, onHighlight, onNote, onCopy, onAskAi, onDismiss }: ToolbarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<"marker" | "underline">("marker");
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!pending || !ref.current) return;
    const w = ref.current.offsetWidth;
    const left = Math.min(window.innerWidth - w - 8, Math.max(8, pending.rect.left + pending.rect.width / 2 - w / 2));
    const top = pending.rect.top - 48 < 58 ? pending.rect.bottom + 8 : pending.rect.top - 48;
    setPos({ left, top });
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, onDismiss]);

  if (!pending) return null;

  return (
    <div
      ref={ref}
      className="popover open vellum-selbar"
      style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 120, display: "flex", alignItems: "center", gap: 6, padding: "5px 8px" }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <span className="seg" style={{ marginRight: 2 }}>
        <button className={style === "marker" ? "on" : ""} onClick={() => setStyle("marker")} title="荧光笔">
          高亮
        </button>
        <button className={style === "underline" ? "on" : ""} onClick={() => setStyle("underline")} title="下划线">
          下划线
        </button>
      </span>
      {COLORS.map((c) => (
        <button
          key={c}
          className={`dot-${c}`}
          title={`${COLOR_NAMES[c]}色`}
          style={{ width: 16, height: 16, borderRadius: "50%" }}
          onClick={() => onHighlight(c, style)}
        />
      ))}
      <button className="btn sm" onClick={onNote} title="写笔记">
        笔记
      </button>
      <button className="btn sm" onClick={onAskAi} title="把这句引用到问 AI">
        问 AI
      </button>
      <button className="btn sm" onClick={onCopy} title="复制">
        复制
      </button>
    </div>
  );
}
