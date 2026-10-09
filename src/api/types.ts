/** Domain types mirroring the Vellum Python backend (paper.json / library summaries). */

export type ThemeMode = "light" | "dark" | "system";

/** One entry from ``GET /api/library`` -> items[]. */
export type PaperSummary = {
  id: string;
  title_zh: string;
  title_en: string;
  short_zh: string;
  target: string;
  authors: string;
  affiliation: string;
  year: string;
  date: string;
  venue: string;
  arxiv: string;
  url: string;
  doi: string;
  pages: number;
  done_pages: number;
  en_pages: number;
  abstract: string;
  tags: string[];
  status: "unread" | "reading" | "done" | string;
  starred: boolean;
  added: string;
  last_opened: string;
  progress: number;
  notes: number;
  highlights: number;
  open_questions: number;
  discussions: number;
  has_paper_note: boolean;
  job: JobInfo | null;
  thumb: string;
};

export type JobInfo = {
  type?: string;
  state?: string;
  message?: string;
  done?: number;
  total?: number;
  updated?: string;
  error?: string;
  failed?: Record<string, string>;
  scope?: string;
  read?: boolean;
  model?: string;
  target?: string;
  pages?: number[];
  cap_check?: boolean;
  page_cap?: number;
  usage?: Usage;
  usage_total?: Usage;
};

export type Usage = {
  engine?: string;
  calls?: number;
  input?: number;
  cached?: number;
  output?: number;
  cost_usd?: number;
};

export type SentenceAlign = [number, number];

export type BlockItem = { en?: string; zh?: string; sents?: SentenceAlign[] };

/** A content block inside paper.json. */
export type Block = {
  id: string;
  type: "heading" | "para" | "list" | "math" | "table" | "figure" | "references" | "note";
  page?: number;
  en?: string;
  zh?: string;
  sents?: SentenceAlign[];
  level?: number;
  num?: string;
  appendix?: boolean;
  role?: string;
  cont?: boolean;
  ordered?: boolean;
  items?: BlockItem[];
  tex?: string;
  tag?: string;
  align?: string;
  head?: (string | number)[][];
  rows?: (string | number)[][];
  caption_en?: string;
  caption_zh?: string;
  caption_pos?: "above" | "below";
  src?: string;
  box?: number[];
  abox?: number[];
  image_en?: string;
  image_zh?: string;
};

export type PageMeta = { n: number; w: number; h: number; img: string };

export type PaperMeta = {
  title_zh?: string;
  title_en?: string;
  short_zh?: string;
  authors?: string;
  affiliation?: string;
  source?: string;
  pdf?: string;
  pages?: PageMeta[];
  page_count?: number;
  year?: string;
  date?: string;
  venue?: string;
  arxiv?: string;
  doi?: string;
  url?: string;
  target?: string;
};

export type Translation = {
  scope?: string;
  done_pages?: number[];
  en_pages?: number[];
  note?: string;
};

export type GlossaryEntry = { en: string; zh: string };
export type ReferenceEntry = { id: string; text: string };

export type Paper = {
  schema?: number;
  meta: PaperMeta;
  translation: Translation;
  glossary: GlossaryEntry[];
  references: ReferenceEntry[];
  blocks: Block[];
};

export type ReaderState = {
  schema?: number;
  rev?: number;
  edits?: Record<string, { zh?: string; base?: string; at?: string; reverted?: boolean; prev?: string }>;
  notes?: Record<string, Note>;
  paper_note?: { body?: string; at?: string };
  progress?: { block?: string; ratio?: number; at?: string };
};

export type Note = {
  id: string;
  kind?: "highlight" | "note" | "question";
  anchor?: string;
  /** The editable key (block id, or id#item) the quote lives in. */
  key?: string;
  quote?: string;
  prefix?: string;
  suffix?: string;
  body?: string;
  color?: "yellow" | "green" | "blue" | "pink";
  style?: "marker" | "underline";
  side?: "en" | "zh";
  /** Multi-block selection: one anchor record per block. */
  parts?: { anchor: string; key?: string; quote: string; prefix?: string; suffix?: string; side?: "en" | "zh" }[];
  created?: string;
  updated?: string;
  deleted?: boolean;
};

/** Full reader payload from ``GET /api/p/<id>/state``. */
export type ReaderPayload = {
  id: string;
  paper: Paper;
  reader: ReaderState;
  discussion: { entries: DiscussionEntry[] };
  layout: Record<string, unknown>;
  item: Record<string, unknown>;
  job: JobInfo;
  versions: Record<string, string>;
  token: string;
  library_status: string;
  engine: string;
};

export type DiscussionEntry = {
  id: string;
  kind?: string;
  anchor?: string;
  body?: string;
  quote?: string;
  reply_to?: string;
  at?: string;
  by?: string;
};

export type EngineFound = {
  found: boolean;
  version: string;
};

export type EnginesResponse = {
  found: { opencode?: EngineFound; ollama?: { running: boolean; models: string[] } };
  ready: boolean;
  engine: string;
  models: {
    opencode?: { models: { id: string; name: string; provider: string; vision?: boolean }[] };
  };
};

export type ConfigResponse = {
  config: {
    engine: string;
    target: string;
    opencode: { command: string; model: string; vision: boolean; timeout: number };
    openai: {
      preset: string;
      base_url: string;
      api?: string;
      model: string;
      vision?: boolean;
      has_key?: boolean;
      api_key?: string;
      saved_keys?: string[];
    };
    page_cap: number;
    batch_pages: number;
    concurrency: number;
    auto_translate: boolean;
  };
  presets: Preset[];
  groups: [string, string][];
  engine_label?: string;
};

/** One provider preset from the backend (`presets.py`). */
export type PresetModel = { id: string; name: string; tag?: string; vision?: boolean };

export type Preset = {
  id: string;
  region: "cn" | "intl" | "local" | string;
  name: string;
  base_url: string;
  model: string;
  key: boolean;
  free?: boolean;
  api?: string;
  models?: PresetModel[];
  key_url?: string;
  note?: string;
};

export type ChatModelEntry = {
  id: string;
  name: string;
  engine: "opencode" | "openai";
  model: string;
  label: string;
  source: string;
  ready: boolean;
  hint: string;
  detail: string;
};

export type ChatModelsResponse = {
  models: ChatModelEntry[];
  default: string;
  translate: string;
  presets: { id: string; name: string; models: unknown[]; api: string }[];
};

// ---- localStorage preferences ----
const PREFS_KEY = "vellum.prefs.v1";

export type Prefs = {
  theme: ThemeMode;
  view: "original" | "translation" | "both";
  fontScale: number;
  measure: number;
};

export const DEFAULT_PREFS: Prefs = {
  theme: "system",
  view: "both",
  fontScale: 1,
  measure: 35,
};

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable */
  }
}
