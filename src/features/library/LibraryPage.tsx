import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileUp,
  Download,
  Loader2,
  PanelLeftClose,
  Search,
  Settings,
  Star,
  Trash2,
} from "lucide-react";
import { importPdf } from "../../api/backend";
import {
  artifactUrl,
  cancelPaper,
  deletePaper,
  exportPaper,
  getChatModels,
  getLibrary,
  getSessionToken,
  patchItem,
  setSessionToken,
  translatePaper,
  type LibraryResponse,
} from "../../api/vellum";
import type { ChatModelEntry, PaperSummary } from "../../api/types";
import { useToast } from "../../components/Toast";

type Props = {
  engineLabel: string;
  onOpenReader: (id: string) => void;
  onOpenSettings: () => void;
  settingsRev?: number;
};

type SortKey = "opened" | "added" | "year" | "title";
type Filter = "all" | "starred" | "reading" | "unread" | "done";

const SIDE_KEY = "vellum.side.open";

export function LibraryPage({ engineLabel, onOpenReader, onOpenSettings, settingsRev }: Props) {
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("opened");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [models, setModels] = useState<ChatModelEntry[]>([]);
  const [importModel, setImportModel] = useState("");
  const [translateOnImport, setTranslateOnImport] = useState(true);
  // Sidebar: pinned open, or collapsed to a thin rail that peeks on hover.
  const [sideOpen, setSideOpen] = useState(() => localStorage.getItem(SIDE_KEY) !== "0");
  const [sidePeek, setSidePeek] = useState(false);
  const { push } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem(SIDE_KEY, sideOpen ? "1" : "0");
  }, [sideOpen]);

  const reload = useCallback(async () => {
    try {
      const next = await getLibrary();
      setSessionToken(next.token);
      setData(next);
    } catch (error) {
      push(error instanceof Error ? error.message : "读取文献库失败", "err");
    }
  }, [push]);

  const reloadModels = useCallback(() => {
    getChatModels()
      .then((r) => {
        setModels(r.models);
        setImportModel(r.translate || r.default || r.models[0]?.id || "");
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), 4000);
    return () => window.clearInterval(timer);
  }, [reload]);

  useEffect(() => {
    reloadModels();
    void reload();
  }, [reloadModels, reload, settingsRev]);

  const items = data?.items ?? [];
  const selectedPaper = items.find((i) => i.id === selected) ?? null;

  const filtered = useMemo(() => {
    let list = items.slice();
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((i) =>
        [i.title_zh, i.title_en, i.authors, i.venue, i.abstract, ...(i.tags ?? [])]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    if (filter === "starred") list = list.filter((i) => i.starred);
    else if (filter === "reading") list = list.filter((i) => i.status === "reading");
    else if (filter === "unread") list = list.filter((i) => i.status === "unread");
    else if (filter === "done") list = list.filter((i) => i.status === "done");
    list.sort((a, b) => {
      if (sort === "title") return (a.title_zh || a.title_en).localeCompare(b.title_zh || b.title_en);
      if (sort === "year") return (b.year || "").localeCompare(a.year || "");
      if (sort === "added") return (b.added || "").localeCompare(a.added || "");
      return (b.last_opened || "").localeCompare(a.last_opened || "");
    });
    return list;
  }, [items, query, filter, sort]);

  const counts = useMemo(() => {
    const c = { all: items.length, starred: 0, reading: 0, unread: 0, done: 0 };
    for (const i of items) {
      if (i.starred) c.starred += 1;
      if (i.status === "reading") c.reading += 1;
      else if (i.status === "done") c.done += 1;
      else c.unread += 1;
    }
    return c;
  }, [items]);

  const onPickFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setImporting(true);
    try {
      for (const file of Array.from(files)) {
        const result = await importPdf(file, file.name, {
          translate: translateOnImport,
          model: importModel,
          token: data?.token || getSessionToken(),
        });
        push(result.new ? `已导入：${file.name}` : `已在库中：${file.name}`, "ok");
      }
      await reload();
    } catch (error) {
      push(error instanceof Error ? error.message : "导入失败", "err");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    void onPickFiles(event.dataTransfer.files);
  };

  return (
    <div onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header className="topbar">
        <span className="brand">
          <img className="mark" src="/logo-128.png" alt="" aria-hidden="true" />
          <span>Vellum</span>
        </span>
        <label className="search">
          <Search size={15} />
          <input
            type="search"
            placeholder="搜索标题、作者、分类、摘要"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <span className="grow" />
        <button className="engine-chip" onClick={onOpenSettings} title="模型设置">
          <span className="dot" />
          <span>{engineLabel || "未配置模型"}</span>
        </button>
        <button className="btn accent" onClick={() => fileRef.current?.click()} disabled={importing}>
          {importing ? <Loader2 size={15} className="spin" /> : <FileUp size={15} />}
          <span>导入</span>
        </button>
        <button className="btn icon" onClick={onOpenSettings} title="设置">
          <Settings size={16} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => void onPickFiles(e.target.files)}
        />
      </header>

      <div
        className={`lib ${selectedPaper ? "has-detail" : ""} ${sideOpen ? "" : "side-closed"} ${
          sidePeek ? "side-peek" : ""
        }`}
      >
        <button
          className="side-rail"
          aria-label="展开文献库侧栏"
          onMouseEnter={() => setSidePeek(true)}
          onClick={() => {
            setSideOpen(true);
            setSidePeek(false);
          }}
        />
        <nav
          className="side"
          onMouseLeave={() => !sideOpen && setSidePeek(false)}
          // While peeking, any click inside pins the sidebar open (matching the
          // "hover to peek, click to pin" behaviour).
          onClick={() => {
            if (!sideOpen) {
              setSideOpen(true);
              setSidePeek(false);
            }
          }}
        >
          <h3>
            <span>文献库</span>
            <button
              className="side-toggle"
              title="收起侧栏"
              onClick={() => {
                setSideOpen(false);
                setSidePeek(false);
              }}
            >
              <PanelLeftClose size={15} />
            </button>
          </h3>
          {(
            [
              ["all", "全部论文", counts.all],
              ["starred", "星标", counts.starred],
              ["reading", "在读", counts.reading],
              ["unread", "未读", counts.unread],
              ["done", "已读", counts.done],
            ] as [Filter, string, number][]
          ).map(([id, label, n]) => (
            <button key={id} className={filter === id ? "on" : ""} onClick={() => setFilter(id)}>
              <span className="t">{label}</span>
              <span className="n">{n}</span>
            </button>
          ))}
        </nav>

        <main className="main">
          <div className="list-head">
            <h1>{filter === "all" ? "全部论文" : "筛选"}</h1>
            <span className="count">{filtered.length} 篇</span>
            <span className="grow" />
            <label className="sort">
              排序
              <select className="input" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                <option value="opened">最近打开</option>
                <option value="added">最近添加</option>
                <option value="year">发表年份</option>
                <option value="title">标题</option>
              </select>
            </label>
          </div>
          <div className="list">
            {!data ? (
              <div className="empty-state">
                <Loader2 size={22} className="spin" />
                <div className="big">加载中…</div>
              </div>
            ) : filtered.length === 0 ? (
              <div className="empty-state">
                <div className="big">还没有论文</div>
                <p>把 PDF 拖进窗口，或点右上角“导入”。</p>
              </div>
            ) : (
              filtered.map((paper) => (
                <PaperRow
                  key={paper.id}
                  paper={paper}
                  active={paper.id === selected}
                  onSelect={() => setSelected(paper.id)}
                  onOpen={() => onOpenReader(paper.id)}
                />
              ))
            )}
          </div>
        </main>

        {selectedPaper && (
          <aside className="detail">
            <div className="detail-head">
              <span>详情</span>
              <button className="detail-close" onClick={() => setSelected(null)} aria-label="关闭">
                ×
              </button>
            </div>
            <PaperDetail
              paper={selectedPaper}
              onOpen={() => onOpenReader(selectedPaper.id)}
              onChanged={reload}
            />
          </aside>
        )}
      </div>
    </div>
  );
}

function PaperRow({
  paper,
  active,
  onSelect,
  onOpen,
}: {
  paper: PaperSummary;
  active: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const title = paper.title_zh || paper.title_en || "（无标题）";
  const subtitle = paper.title_zh && paper.title_en ? paper.title_en : "";
  const total = paper.pages || 0;
  const done = paper.done_pages || 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (paper.thumb) {
      artifactUrl(paper.id, "pages/page-001.webp").then((u) => {
        if (alive) setThumbUrl(u);
      });
    }
    return () => {
      alive = false;
    };
  }, [paper.id, paper.thumb]);
  return (
    <div
      className={`row ${active ? "on" : ""}`}
      role="listbox"
      onClick={onSelect}
      onDoubleClick={onOpen}
    >
      <div
        className={`thumb ${thumbUrl ? "" : "blank"}`}
        style={thumbUrl ? { backgroundImage: `url(${thumbUrl})` } : undefined}
      >
        {!thumbUrl && <span style={{ fontSize: 11 }}>PDF</span>}
      </div>
      <div>
        <div className="t1">
          {paper.starred && <Star size={14} className="star" />}
          <span>{title}</span>
        </div>
        {subtitle && <div className="t2">{subtitle}</div>}
        <div className="t3">
          {paper.authors && <span>{paper.authors.split(",")[0]}</span>}
          {paper.venue && <span>{paper.venue}</span>}
          {paper.year && <span>{paper.year}</span>}
          {paper.open_questions > 0 && <span className="chip">待回答 {paper.open_questions}</span>}
        </div>
      </div>
      <div className="side-info">
        <div className="meter">
          <i style={{ width: `${pct}%` }} />
        </div>
        <span className="stat">
          {done}/{total} 页
        </span>
        {paper.job?.state && ["queued", "running"].includes(paper.job.state) && (
          <span className="stat job">
            <Loader2 size={12} className="spin" /> {paper.job.message || "处理中"}
          </span>
        )}
        {paper.job?.state === "error" && <span className="stat err">出错</span>}
        {paper.job?.state === "partial" && <span className="stat err">部分失败</span>}
      </div>
    </div>
  );
}

function PaperDetail({
  paper,
  onOpen,
  onChanged,
}: {
  paper: PaperSummary;
  onOpen: () => void;
  onChanged: () => Promise<void>;
}) {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (paper.thumb) {
      artifactUrl(paper.id, "pages/page-001.webp").then((u) => {
        if (alive) setCoverUrl(u);
      });
    }
    return () => {
      alive = false;
    };
  }, [paper.id, paper.thumb]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await onChanged();
      push(label, "ok");
    } catch (error) {
      push(error instanceof Error ? error.message : "操作失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const job = paper.job;
  const running = !!job && ["queued", "running"].includes(job.state ?? "");
  const total = paper.pages || 0;
  const done = paper.done_pages || 0;
  const untranslated = Math.max(0, total - done);

  return (
    <div className="detail-inner">
      <div className="cover">
        <div
          className={`thumb ${coverUrl ? "" : "blank"}`}
          style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}
        />
        <div className="actions">
          <button className="btn accent" onClick={onOpen} disabled={busy}>
            打开阅读
          </button>
          {running ? (
            <button
              className="btn line"
              disabled={busy}
              onClick={() => run("已请求停止", () => cancelPaper(paper.id))}
            >
              停止翻译
            </button>
          ) : untranslated > 0 ? (
            <button
              className="btn line"
              disabled={busy}
              onClick={() => run("已加入翻译队列", () => translatePaper(paper.id, {}))}
            >
              翻译{paper.en_pages ? "剩余" : "全文"}
            </button>
          ) : null}
          <div className="act-row">
            <button
              className="btn sm line"
              disabled={busy}
              onClick={() => run("已更新", () => patchItem(paper.id, { starred: !paper.starred }))}
            >
              <Star size={13} /> {paper.starred ? "取消星标" : "星标"}
            </button>
            <button
              className="btn sm line danger"
              disabled={busy}
              onClick={() =>
                run("已移入回收站", async () => {
                  await deletePaper(paper.id);
                })
              }
            >
              <Trash2 size={13} />
            </button>
          </div>
          {paper.done_pages > 0 && (
            <button
              className="btn line"
              disabled={busy}
              onClick={() => run("已导出离线 HTML", () => exportPaper(paper.id))}
              title="导出单个 HTML 文件，双击即可离线阅读"
            >
              <Download size={14} /> 导出离线 HTML
            </button>
          )}
        </div>
      </div>

      <h3 className="title-main">{paper.title_zh || paper.title_en}</h3>
      {paper.title_zh && paper.title_en && <p className="title-sub">{paper.title_en}</p>}

      <div className="kv">
        {paper.authors && (
          <>
            <span>作者</span>
            <span>{paper.authors}</span>
          </>
        )}
        {paper.venue && (
          <>
            <span>出处</span>
            <span>
              {paper.venue} {paper.year}
            </span>
          </>
        )}
        {paper.doi && (
          <>
            <span>DOI</span>
            <span>{paper.doi}</span>
          </>
        )}
      </div>

      <h4>翻译进度</h4>
      <div className="jobbox">
        {job?.message || (done >= total && total ? "全文已翻译" : `已译 ${done} / ${total} 页`)}
        <div className="bar">
          <i style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
        {job?.error && <div className="err">{job.error}</div>}
        {job?.failed && Object.keys(job.failed).length > 0 && (
          <div className="row2">
            <button
              className="btn sm line"
              disabled={busy}
              onClick={() => run("已重试失败页", () => translatePaper(paper.id, { failed: true }))}
            >
              重试失败的页
            </button>
          </div>
        )}
      </div>

      {paper.abstract && (
        <>
          <h4>摘要</h4>
          <div className="abstract open">{paper.abstract}</div>
        </>
      )}

      <h4>标记</h4>
      <div className="counts">
        <div>
          <b>{paper.highlights}</b>划线
        </div>
        <div>
          <b>{paper.notes}</b>笔记
        </div>
        <div>
          <b>{paper.open_questions}</b>待答
        </div>
      </div>
    </div>
  );
}
