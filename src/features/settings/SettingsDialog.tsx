/**
 * Settings: how translation reaches a model, and where data is kept.
 *
 * Translation is a direct API call to any OpenAI-compatible endpoint (Chat
 * Completions / Responses) or the Anthropic Messages API — no CLI required.
 */
import { useEffect, useMemo, useState } from "react";
import { FolderOpen, Loader2 } from "lucide-react";
import {
  getConfig,
  getEngines,
  getLibraryLocation,
  listModels,
  moveLibrary,
  pickFolder,
  restartBackend,
  saveConfig,
  testEngine,
} from "../../api/vellum";
import { inTauri } from "../../api/backend";
import type { ConfigResponse, EnginesResponse, LibraryLocation, Preset } from "../../api/types";
import { useToast } from "../../components/Toast";

type Props = {
  onClose: () => void;
  onSaved: () => void;
};

const API_KINDS: [string, string][] = [
  ["chat", "Chat Completions（通用）"],
  ["responses", "Responses（OpenAI 新接口）"],
  ["messages", "Messages（Anthropic）"],
];

const REGION_LABEL: Record<string, string> = {
  cn: "国内直连",
  intl: "海外（国内要开梯子）",
  local: "本机运行（离线、免费）",
};

const masked = (v?: string) => !!v && v.startsWith("••••");
const fmtGB = (bytes: number) => (bytes ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : "");

export function SettingsDialog({ onClose, onSaved }: Props) {
  const [config, setConfig] = useState<ConfigResponse["config"] | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [groups, setGroups] = useState<[string, string][]>([]);
  const [found, setFound] = useState<EnginesResponse["found"] | null>(null);
  const [pageCap, setPageCap] = useState(60);
  const [batchPages, setBatchPages] = useState(2);
  const [concurrency, setConcurrency] = useState(0);
  const [busy, setBusy] = useState(false);
  const { push } = useToast();

  // Direct-API form state.
  const [preset, setPreset] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [api, setApi] = useState("chat");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [vision, setVision] = useState(false);
  const [savedKeys, setSavedKeys] = useState<string[]>([]);
  const [fetched, setFetched] = useState<string[]>([]);
  const [fetchMsg, setFetchMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [testMsg, setTestMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [typingModel, setTypingModel] = useState(false);

  // Data location.
  const [location, setLocation] = useState<LibraryLocation | null>(null);
  const [newDir, setNewDir] = useState("");

  useEffect(() => {
    getConfig()
      .then((c) => {
        const cfg = c.config;
        setConfig(cfg);
        setPresets(c.presets ?? []);
        setGroups((c.groups as [string, string][]) ?? []);
        setPageCap(cfg.page_cap ?? 60);
        setBatchPages(cfg.batch_pages ?? 2);
        setConcurrency(cfg.concurrency ?? 0);
        setPreset(cfg.openai?.preset ?? "");
        setBaseUrl(cfg.openai?.base_url ?? "");
        setApi(cfg.openai?.api ?? "chat");
        setApiKey(cfg.openai?.api_key ?? "");
        setModel(cfg.openai?.model ?? "");
        setVision(cfg.openai?.vision ?? false);
        setSavedKeys(cfg.openai?.saved_keys ?? []);
      })
      .catch((e) => push(e instanceof Error ? e.message : "读取配置失败", "err"));
    getLibraryLocation()
      .then((l) => {
        setLocation(l);
        setNewDir(l.path);
      })
      .catch(() => undefined);
  }, [push]);

  useEffect(() => {
    let alive = true;
    getEngines(true)
      .then((e) => alive && setFound(e.found))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const current = presets.find((p) => p.id === preset);
  const hasKey = (id: string) => savedKeys.includes(id);
  const presetModels = useMemo(() => current?.models ?? [], [current]);

  /** Switching provider fills in its address, api kind and default model. */
  const pickPreset = (id: string) => {
    const p = presets.find((x) => x.id === id);
    setPreset(id);
    setFetched([]);
    setFetchMsg(null);
    setTestMsg(null);
    setTypingModel(false);
    if (p) {
      setBaseUrl(p.base_url);
      setApi(p.api ?? "chat");
      const first = p.models?.[0];
      const pick = p.model || first?.id || "";
      setModel(pick);
      setVision(!!p.models?.find((m) => m.id === pick)?.vision);
      setApiKey(hasKey(id) ? "••••" : "");
    } else {
      if (config?.openai?.preset === "") {
        setBaseUrl(config?.openai?.base_url ?? "");
        setApi(config?.openai?.api ?? "chat");
        setModel(config?.openai?.model ?? "");
        setVision(config?.openai?.vision ?? false);
        setApiKey(config?.openai?.api_key ? "••••" : "");
      } else {
        setBaseUrl("");
        setApi("chat");
        setModel("");
        setVision(false);
        setApiKey("");
      }
    }
  };

  const onPickModel = (id: string) => {
    if (id === "__type") {
      setTypingModel(true);
      return;
    }
    setModel(id);
    const m = presetModels.find((x) => x.id === id);
    if (m) setVision(!!m.vision);
  };

  const fetchModels = async () => {
    setFetchMsg(null);
    try {
      const r = await listModels({ base_url: baseUrl, preset, api_key: masked(apiKey) ? "" : apiKey });
      if (r.ok && r.models?.length) {
        setFetched(r.models);
        setTypingModel(false);
        setFetchMsg({ text: `读到 ${r.models.length} 个模型`, ok: true });
      } else {
        setFetchMsg({ text: r.message || "这个地址不提供模型列表，手填模型名", ok: false });
        setTypingModel(true);
      }
    } catch (e) {
      setFetchMsg({ text: e instanceof Error ? e.message : "获取失败", ok: false });
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await saveConfig({
        engine: "openai",
        page_cap: pageCap,
        batch_pages: batchPages,
        concurrency,
        openai: {
          preset,
          base_url: baseUrl.trim(),
          api,
          api_key: apiKey,
          model: model.trim(),
          vision,
        },
      });
      push("设置已保存", "ok");
      onSaved();
      onClose();
    } catch (error) {
      push(error instanceof Error ? error.message : "保存失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setTestMsg(null);
    try {
      const r = await testEngine("openai", {
        preset,
        base_url: baseUrl.trim(),
        api,
        api_key: apiKey,
        model: model.trim(),
        vision,
      });
      setTestMsg({ text: r.message, ok: r.ok });
      push(r.message, r.ok ? "ok" : "err");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "测试出错";
      setTestMsg({ text: msg, ok: false });
      push(msg, "err");
    } finally {
      setBusy(false);
    }
  };

  const browse = async () => {
    try {
      const r = await pickFolder("选择存放文献库的文件夹");
      if (r.path) setNewDir(r.path);
      else if (!r.supported) push("这台机器弹不出文件夹窗口，直接填路径即可", "info");
    } catch (e) {
      push(e instanceof Error ? e.message : "打开文件夹窗口失败", "err");
    }
  };

  const applyDir = async () => {
    const target = newDir.trim();
    if (!target || target === location?.path) return;
    const empty = location?.papers === 0;
    setBusy(true);
    try {
      const r = await moveLibrary(target, empty ? "use" : "copy");
      push(r.message || `已搬到 ${r.path}`, "ok");
      setLocation((l) => (l ? { ...l, path: r.path, restart_required: true } : l));
      if (inTauri()) {
        await restartBackend();
        // The sidecar comes back on a new port, so re-resolve the backend URL
        // by reloading the webview.
        window.location.reload();
      }
    } catch (e) {
      push(e instanceof Error ? e.message : "更改失败", "err");
    } finally {
      setBusy(false);
    }
  };

  const recommendedIds = presetModels.map((m) => m.id);
  const extraModels = fetched.filter((m) => !recommendedIds.includes(m));
  const showSelect = !typingModel && (recommendedIds.length > 0 || extraModels.length > 0);
  const dirChanged = !!location && newDir.trim() !== "" && newDir.trim() !== location.path;

  return (
    <div className="dialog-backdrop open" onClick={onClose}>
      <div className="dialog" role="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="vellum-settings">
          <h2>设置</h2>

          <div className="field">
            <span>翻译引擎</span>
            <div className="row-line">
              <span className="grow">
                直连模型接口{" "}
                {found?.ollama?.running ? (
                  <span style={{ color: "var(--ink-3)" }}>· 检测到本机 Ollama</span>
                ) : null}
              </span>
            </div>
            <p className="hint">
              填服务商的地址和 Key 即可，不依赖任何命令行工具。下面也内置了 Ollama、LM Studio 等本机选项。
            </p>
          </div>

          <div className="field">
            <span>服务商</span>
            <div className="preset-tiles grouped">
              {groups.map(([region, label]) => {
                const list = presets.filter((p) => p.region === region);
                if (!list.length) return null;
                return (
                  <div className="preset-group" key={region}>
                    <span>{label || REGION_LABEL[region]}</span>
                    {list.map((p) => (
                      <button
                        key={p.id}
                        className={preset === p.id ? "on" : ""}
                        onClick={() => pickPreset(p.id)}
                      >
                        {p.name}
                        {p.free ? <i className="free-tag">免费</i> : null}
                        {hasKey(p.id) ? <span className="ok-dot" title="已存 Key" /> : null}
                      </button>
                    ))}
                  </div>
                );
              })}
              <div className="preset-group">
                <span>其他</span>
                <button className={preset === "" ? "on" : ""} onClick={() => pickPreset("")}>
                  自定义地址
                </button>
                <em className="hint">任意 OpenAI 兼容接口、中转站</em>
              </div>
            </div>
          </div>

          {current ? (
            <p className="hint preset-note">
              {current.note}
              {current.key_url ? (
                <a href={current.key_url} target="_blank" rel="noopener">
                  {current.key ? " 获取 Key ↗" : " 下载 ↗"}
                </a>
              ) : null}
            </p>
          ) : null}

          {!current ? (
            <div className="grid2">
              <label className="field">
                <span>接口地址（base URL）</span>
                <input
                  className="input"
                  value={baseUrl}
                  placeholder="https://…/v1"
                  onChange={(e) => {
                    const next = e.target.value;
                    setBaseUrl(next);
                    if (
                      preset === "" &&
                      apiKey.startsWith("••••") &&
                      next.trim() !== (config?.openai?.base_url || "").trim()
                    ) {
                      setApiKey("");
                    }
                  }}
                />
              </label>
              <label className="field">
                <span>接口格式</span>
                <select className="input" value={api} onChange={(e) => setApi(e.target.value)}>
                  {API_KINDS.map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}

          {current && !current.key ? null : (
            <label className="field">
              <span>API Key</span>
              <input
                className="input"
                type="password"
                autoComplete="off"
                value={masked(apiKey) ? "" : apiKey}
                placeholder={hasKey(preset) ? "已保存，留空不改" : "sk-…"}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </label>
          )}

          <label className="field">
            <span>模型</span>
            <div className="model-row">
              {showSelect ? (
                <select className="input" value={model} onChange={(e) => onPickModel(e.target.value)}>
                  {!model ? <option value="">选一个模型</option> : null}
                  {model && !recommendedIds.includes(model) && !extraModels.includes(model) ? (
                    <option value={model}>{model}</option>
                  ) : null}
                  {recommendedIds.length ? (
                    <optgroup label="推荐">
                      {presetModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                          {m.tag ? ` · ${m.tag}` : ""}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {extraModels.length ? (
                    <optgroup label="接口里的全部模型">
                      {extraModels.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  <option value="__type">手填模型名…</option>
                </select>
              ) : (
                <input
                  className="input"
                  value={model}
                  placeholder="模型名，比如 deepseek-flash"
                  onChange={(e) => setModel(e.target.value)}
                />
              )}
              <button className="btn sm line" onClick={() => void fetchModels()} disabled={busy}>
                获取模型列表
              </button>
            </div>
            {fetchMsg ? (
              <span className="test-result" style={{ color: fetchMsg.ok ? "var(--ok)" : "var(--danger)" }}>
                {fetchMsg.text}
              </span>
            ) : null}
          </label>

          <label className="field row-line" style={{ display: "flex", gap: 8 }}>
            <input type="checkbox" checked={vision} onChange={(e) => setVision(e.target.checked)} />
            <span>模型能看图（把 PDF 原页图一起发过去，公式和表格更准）</span>
          </label>

          <label className="field">
            <span>全文页数确认上限</span>
            <input
              className="input"
              type="number"
              min={0}
              value={pageCap}
              onChange={(e) => setPageCap(Number(e.target.value))}
            />
            <p className="hint">超过这个页数会先确认再翻译；填 0 表示不限制。</p>
          </label>

          <div className="grid2">
            <label className="field">
              <span>每次交给模型的页数</span>
              <select
                className="input"
                value={batchPages}
                onChange={(e) => setBatchPages(Number(e.target.value))}
              >
                <option value={1}>1 页（最稳，模型输出不易截断）</option>
                <option value={2}>2 页（默认）</option>
                <option value={3}>3 页（快一些，长论文可能被截断）</option>
              </select>
              <p className="hint">页数越多越快，但单次输出变长，超出模型上限会被截断。</p>
            </label>
            <label className="field">
              <span>同时翻译几段</span>
              <select
                className="input"
                value={concurrency}
                onChange={(e) => setConcurrency(Number(e.target.value))}
              >
                <option value={0}>自动（推荐）</option>
                <option value={1}>1 段（最省流量）</option>
                <option value={2}>2 段</option>
                <option value={4}>4 段（最快，容易被限流）</option>
                <option value={8}>8 段（最快，容易被限流）</option>
              </select>
              <p className="hint">同时开几段一起译。开太多可能触发服务商限流。</p>
            </label>
          </div>

          <hr className="settings-rule" />

          <div className="field">
            <span>数据保存位置</span>
            <div className="model-row">
              <input
                className="input"
                value={newDir}
                placeholder="选择一个文件夹"
                onChange={(e) => setNewDir(e.target.value)}
                disabled={location?.temp}
              />
              <button className="btn sm line" onClick={() => void browse()} disabled={busy || location?.temp}>
                <FolderOpen size={14} /> 浏览
              </button>
            </div>
            <p className="hint">
              {location
                ? `当前：${location.path}（${location.papers} 篇${fmtGB(location.bytes) ? `，${fmtGB(location.bytes)}` : ""}）`
                : "读取中…"}
              {location?.temp ? " · 临时文献库不能更改位置" : ""}
            </p>
            {dirChanged ? (
              <p className="hint">
                会把当前文献库{location?.papers ? "复制" : "指向"}到新位置，旧文件夹保留不删。
                {inTauri() ? "完成后应用会自动重启生效。" : "保存后重启应用生效。"}
              </p>
            ) : null}
          </div>

          {testMsg ? (
            <div className="field">
              <span
                style={{
                  color: testMsg.ok ? "var(--ok, #10b981)" : "var(--danger, #ef4444)",
                  fontSize: 13,
                  lineHeight: 1.4,
                  wordBreak: "break-all",
                }}
              >
                {testMsg.text}
              </span>
            </div>
          ) : null}

          <div className="actions">
            {dirChanged ? (
              <button className="btn line" onClick={() => void applyDir()} disabled={busy}>
                {busy && <Loader2 size={14} className="spin" />} 更改数据位置
              </button>
            ) : null}
            <button className="btn line" onClick={test} disabled={busy}>
              测试引擎
            </button>
            <button className="btn" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button className="btn accent" onClick={save} disabled={busy || !config}>
              {busy && <Loader2 size={14} className="spin" />} 保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
