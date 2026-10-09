/** Inline markup rendering, ported from easyread's markup.js.
 *
 * Handles `$TeX$` / `\(TeX\)` / `$$TeX$$` / `\[TeX\]`, `**bold**`, `*italic*`,
 * `` `code` ``, citation markers `[n]`, and cross-references like `图 2` /
 * `式 (3)` / `Section 2.1`. The same renderer is used for translations,
 * discussions and notes so the user always sees one consistent dialect.
 */
import katex from "katex";
import type { ReactNode } from "react";

const TOKEN =
  /(?<!\\)(`+)([\s\S]*?)\1|(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$|(?<![\\$])\$(?!\$)((?:\\\$|[^$])+?)(?<!\\)\$(?!\$)|(?<!\\)\\\[([\s\S]+?)(?<!\\)\\\]|(?<!\\)\\\(([\s\S]+?)(?<!\\)\\\)/g;

type Token = { raw: string; body: string; code: boolean; display: boolean };

export type XrefIndex = { eq: Record<string, string>; tab: Record<string, string>; fig: Record<string, string>; sec: Record<string, string> };

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderTex(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      strict: "ignore",
      trust: false,
      output: "html",
    });
  } catch {
    return `<code>${escapeHtml(tex)}</code>`;
  }
}

/** Split out code/math tokens so markdown and tables cannot damage TeX. */
function tokenize(text: string): { masked: string; tokens: Token[] } {
  const tokens: Token[] = [];
  const prefix = "\uE000\uE000";
  const masked = text.replace(
    TOKEN,
    (raw, ticks: string, code: string, dBlock: string, dInline: string, bBlock: string, pInline: string) => {
      const display = ticks ? ticks.length >= 3 && code.includes("\n") : dBlock != null || bBlock != null;
      const body = ticks
        ? display
          ? code.replace(/^[\w+-]*\r?\n/, "")
          : code
        : dBlock ?? dInline ?? bBlock ?? pInline;
      tokens.push({ raw, body, code: !!ticks, display });
      return `${prefix}${tokens.length - 1}\uE001`;
    },
  );
  return { masked, tokens };
}

type XrefLookup = (kind: keyof XrefIndex, key: string, label: string) => ReactNode;

function xrefLinks(s: string, xref?: XrefLookup): string {
  if (!xref) return s;
  // We only mark positions here; the React layer turns the markers into nodes.
  return s;
}

export type MdOptions = {
  /** Citation ids present in the reference list, for linking `[n]`. */
  refs?: Set<string>;
  /** Called when a citation `[n]` is clicked. */
  onCite?: (n: string) => void;
  /** Cross-reference resolver. */
  onXref?: (kind: keyof XrefIndex, key: string, label: string) => void;
};

/** Render inline markdown to React nodes (no block structure). */
export function inlineNodes(text: string, opts: MdOptions = {}): ReactNode[] {
  const { masked, tokens } = tokenize(String(text ?? ""));
  const out: ReactNode[] = [];
  // Walk the masked string, splitting on token placeholders and markdown.
  const parts = masked.split(/(\uE000\uE000\d+\uE001)/);
  let key = 0;
  for (const part of parts) {
    const m = part.match(/^\uE000\uE000(\d+)\uE001$/);
    if (m) {
      const tok = tokens[Number(m[1])];
      if (tok.code) {
        out.push(
          tok.display ? (
            <pre key={key++}>
              <code>{tok.body}</code>
            </pre>
          ) : (
            <code key={key++}>{tok.body}</code>
          ),
        );
      } else {
        const html = renderTex(tok.display ? tok.body.trim() : tok.body, tok.display);
        out.push(
          tok.display ? (
            <div key={key++} className="eq" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <span key={key++} dangerouslySetInnerHTML={{ __html: html }} />
          ),
        );
      }
      continue;
    }
    out.push(...markdownNodes(part, opts, () => key++));
  }
  return out;
}

/** Handle **bold**, *italic*, [n] citations inside a plain (non-token) run. */
function markdownNodes(text: string, opts: MdOptions, nextKey: () => number): ReactNode[] {
  const out: ReactNode[] = [];
  const regex = /\*\*([^*\n]+)\*\*|(^|[^*])\*([^*\n]+)\*(?!\*)|\[(\d+(?:\s*[,，–-]\s*\d+)*)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] != null) {
      out.push(<strong key={nextKey()}>{m[1]}</strong>);
    } else if (m[3] != null) {
      if (m[2]) out.push(m[2]);
      out.push(<em key={nextKey()}>{m[3]}</em>);
    } else if (m[4] != null) {
      const inner = m[4];
      out.push("[");
      inner.split(/(\s*[,，–-]\s*)/).forEach((piece, i) => {
        if (/^\d+$/.test(piece) && opts.refs?.has(piece)) {
          out.push(
            <a key={nextKey()} className="cite" onClick={() => opts.onCite?.(piece)}>
              {piece}
            </a>,
          );
        } else {
          out.push(piece);
        }
      });
      out.push("]");
    }
    last = regex.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Render one inline string to a React node array. */
export function renderMd(text: string, opts: MdOptions = {}): ReactNode {
  return inlineNodes(text, opts);
}

/** Plain text with markup stripped, for TOC/summaries. */
export function plainText(text: string): string {
  const { masked, tokens } = tokenize(String(text ?? ""));
  return masked
    .replace(/\uE000\uE000(\d+)\uE001/g, (_m, i) => tokens[Number(i)]?.body ?? "")
    .replace(/\*\*|`/g, "");
}

/** Character spans of code/math tokens in the source, so annotation ranges can
 * be snapped to token boundaries and never split a formula in half. */
export function tokenSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  const re = new RegExp(TOKEN.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) spans.push([m.index, m.index + m[0].length]);
  return spans;
}

export type MarkRange = { start: number; end: number; color: string; style?: string; kind?: string; id: string };

/** Snap a [start,end) range outward so it never cuts through a math/code token. */
function snapRange(text: string, start: number, end: number): [number, number] {
  let s = start;
  let e = end;
  for (const [a, b] of tokenSpans(text)) {
    if (s > a && s < b) s = a;
    if (e > a && e < b) e = b;
  }
  return [s, e];
}

/** Render text as React nodes, wrapping marked ranges in <mark>. Adjacent marks
 * are merged; markdown/math inside each slice is rendered normally. */
export function renderTextWithMarks(
  text: string,
  marks: MarkRange[],
  opts: MdOptions,
  onMarkClick?: (id: string) => void,
): ReactNode[] {
  const source = String(text ?? "");
  const snapped = marks
    .map((m) => {
      const [s, e] = snapRange(source, m.start, m.end);
      return { ...m, start: s, end: e };
    })
    .filter((m) => m.end > m.start)
    .sort((a, b) => a.start - b.start);

  if (!snapped.length) return inlineNodes(source, opts);

  // Build boundary points and emit alternating plain/marked slices.
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  let i = 0;
  while (i < snapped.length) {
    const m = snapped[i];
    if (m.start > cursor) {
      nodes.push(<span key={key++}>{inlineNodes(source.slice(cursor, m.start), opts)}</span>);
      cursor = m.start;
    }
    // Merge overlapping marks of the same color/style.
    let end = m.end;
    let j = i + 1;
    while (j < snapped.length && snapped[j].start < end) {
      end = Math.max(end, snapped[j].end);
      j += 1;
    }
    const cls = `hl c-${m.color}${m.style === "underline" ? " s-ul" : ""}${m.kind === "question" ? " q" : ""}`;
    nodes.push(
      <mark
        key={key++}
        className={cls}
        data-note={m.id}
        onClick={(e) => {
          e.stopPropagation();
          onMarkClick?.(m.id);
        }}
      >
        {inlineNodes(source.slice(m.start, end), opts)}
      </mark>,
    );
    cursor = end;
    i = j;
  }
  if (cursor < source.length) nodes.push(<span key={key++}>{inlineNodes(source.slice(cursor), opts)}</span>);
  return nodes;
}
