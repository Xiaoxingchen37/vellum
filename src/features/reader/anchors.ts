/** Anchor resolution for highlights/notes (Hypothesis-style TextQuote:
 * quote + prefix/suffix), and range math against a key's rendered text. */
import type { Note, ReaderState } from "../../api/types";

export type AnchorTarget = {
  note: Note;
  start: number;
  end: number;
};

/** Find a quote in text, preferring the occurrence matching prefix/suffix. */
export function findQuote(text: string, quote: string, prefix?: string, suffix?: string): number {
  if (!quote) return -1;
  let best = -1;
  let bestScore = -1;
  for (let i = text.indexOf(quote); i >= 0; i = text.indexOf(quote, i + 1)) {
    let score = 0;
    if (prefix && text.slice(Math.max(0, i - prefix.length), i).endsWith(prefix.slice(-8))) score += 2;
    if (suffix && text.slice(i + quote.length, i + quote.length + suffix.length).startsWith(suffix.slice(0, 8))) score += 2;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}

export type KeyTextResolver = (key: string) => { text: string; isEn: boolean } | null;

/** Resolve all active (non-deleted) notes anchored to a given key, to char ranges
 * against the *exact* text being rendered. A quote made on the translation is
 * searched only in the translation, and one made on the source only in the
 * source — so a highlight never appears on the wrong side with wrong offsets. */
export function marksForKey(reader: ReaderState, key: string, text: string): AnchorTarget[] {
  const out: AnchorTarget[] = [];
  const blockId = key.split("#")[0];
  for (const note of Object.values(reader.notes || {})) {
    if (note.deleted || !note.quote) continue;
    const parts = note.parts && note.parts.length ? note.parts : [note];
    const part = parts.find((p) => (p.key ?? p.anchor) === key || (!p.key && p.anchor === blockId));
    if (!part) continue;
    const quote = part.quote ?? note.quote;
    const start = findQuote(text, quote, part.prefix ?? note.prefix, part.suffix ?? note.suffix);
    if (start < 0) continue;
    out.push({ note, start, end: start + quote.length });
  }
  return out.sort((a, b) => a.start - b.start);
}
