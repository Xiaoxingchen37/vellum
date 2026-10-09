import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Plus, Send, Sparkles, Square, Trash2, X } from "lucide-react";
import { getChat, streamChat, deleteChatThread, type ChatThread } from "../../api/vellum";
import { getSessionToken } from "../../api/vellum";
import type { ChatModelEntry } from "../../api/types";
import { renderMd } from "../../lib/markup";
import { useToast } from "../../components/Toast";

type Props = {
  projectId: string;
  /** Pre-filled reference from a selection: {anchor, quote}. */
  seed?: { anchor: string; quote: string } | null;
  onClose: () => void;
  onAnswered?: () => void;
};

export function ChatPanel({ projectId, seed, onClose, onAnswered }: Props) {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [models, setModels] = useState<ChatModelEntry[]>([]);
  const [model, setModel] = useState("");
  const [activeThread, setActiveThread] = useState<string>("");
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { push } = useToast();

  const load = useCallback(async () => {
    try {
      const data = await getChat(projectId);
      setThreads(data.threads);
      setModels(data.models);
      setModel((m) => m || data.translate || data.default);
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取对话失败");
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (seed) setInput(`请解释这段：「${seed.quote}」`);
  }, [seed]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [threads, draft]);

  const current = threads.find((t) => t.id === activeThread);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setError("");
    setStreaming(true);
    setDraft("");
    setInput("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      let acc = "";
      const result = await streamChat(
        projectId,
        {
          text,
          thread: activeThread || undefined,
          model: model || undefined,
          anchor: seed?.anchor,
          quote: seed?.quote,
        },
        getSessionToken(),
        (piece) => {
          acc += piece;
          setDraft(acc);
        },
        controller.signal,
      );
      setActiveThread(result.thread);
      await load();
      setDraft("");
      onAnswered?.();
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        push("已停止", "info");
      } else {
        setError(e instanceof Error ? e.message : "回答失败");
      }
      await load();
      setDraft("");
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  const newThread = () => {
    setActiveThread("");
    setDraft("");
    setInput("");
  };

  const removeThread = async (id: string) => {
    if (!id) return;
    try {
      await deleteChatThread(projectId, id);
      if (activeThread === id) setActiveThread("");
      await load();
    } catch (e) {
      push(e instanceof Error ? e.message : "删除失败", "err");
    }
  };

  return (
    <aside className="reader-chat-panel">
      <div className="pane-head">
        <b>
          <Sparkles size={14} /> 问 AI
        </b>
        <button className="btn icon" onClick={onClose} title="关闭">
          <X size={15} />
        </button>
      </div>

      <div className="chat-toolbar">
        <button className="btn sm line" onClick={newThread} title="新对话">
          <Plus size={13} /> 新对话
        </button>
        <select className="input" value={activeThread} onChange={(e) => setActiveThread(e.target.value)} style={{ height: 30 }}>
          <option value="">（新对话）</option>
          {threads.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
        <select className="input" value={model} onChange={(e) => setModel(e.target.value)} style={{ height: 30 }} title="模型">
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        {activeThread && (
          <button className="btn sm line danger" onClick={() => removeThread(activeThread)} title="删除对话">
            <Trash2 size={13} />
          </button>
        )}
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        {seed && (
          <div className="chat-seed">
            引用：<span>{seed.quote}</span>
          </div>
        )}
        {(current?.messages ?? []).map((m, i) => (
          <div key={m.id ?? i} className={`chat-msg ${m.role}`}>
            {m.role === "assistant" && m.model && <div className="chat-model">{m.model}</div>}
            <div className="chat-bubble">{m.role === "assistant" ? renderMd(m.content) : m.content}</div>
          </div>
        ))}
        {draft && (
          <div className="chat-msg assistant">
            <div className="chat-bubble">{renderMd(draft)}</div>
          </div>
        )}
        {streaming && !draft && (
          <div className="chat-msg assistant">
            <div className="chat-bubble">
              <Loader2 size={13} className="spin" /> 模型思考中…
            </div>
          </div>
        )}
        {error && <div className="chat-error">{error}</div>}
      </div>

      <div className="chat-input">
        <textarea
          className="input"
          rows={3}
          placeholder="问关于这篇论文的问题…（Ctrl+Enter 发送）"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {streaming ? (
          <button className="btn line" onClick={stop}>
            <Square size={13} /> 停止
          </button>
        ) : (
          <button className="btn accent" onClick={() => void send()} disabled={!input.trim()}>
            <Send size={14} /> 发送
          </button>
        )}
      </div>
    </aside>
  );
}
