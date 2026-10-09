/**
 * Settings: choose how translation reaches a model.
 *
 * Two engines, with the direct API as the default so Vellum works without any
 * CLI installed:
 *  - "api"      — any OpenAI-compatible endpoint (Chat Completions / Responses)
 *                 or the Anthropic Messages API. Provider presets, per-provider
 *                 keys, model list fetch.
 *  - "opencode" — the local opencode CLI (uses its own logged-in models).
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { getConfig, getEngines, listModels, saveConfig, testEngine } from "../../api/vellum";
import type { ConfigResponse, EnginesResponse, Preset } from "../../api/types";
import { useToast } from "../../components/Toast";

type Props = {
  onClose: () => void;
  onSaved: () => void;
};

type ModelEntry = { id: string; name: string; provider: string; vision?: boolean };

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

export function SettingsDialog({ onClose, onSaved }: Props) {
  const [config, setConfig] = useState<ConfigResponse["config"] | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [groups, setGroups] = useState<[string, string][]>([]);
  const [found, setFound] = useState<EnginesResponse["found"] | null>(null);
  const [opencodeModels, setOpencodeModels] = useState<ModelEntry[]>([]);
  const [opencodeModel, setOpencodeModel] = useState("");
  const [opencodeVision, setOpencodeVision] = useState(true);
  const [pageCap, setPageCap] = useState(60);
  const [busy, setBusy] = useState(false);
  const { push } = useToast();

  // Engine choice + direct-API form state.
  const [engine, setEngine] = useState("openai");
  const [preset, setPreset] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [api, setApi] = useState("chat");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [vision, setVision] = useState(false);
  const [savedKeys, setSavedKeys] = useState<string[]>([]);
  const [fetched, setFetched] = useState<string[]>([]);
  const [fetchMsg, setFetchMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [typingModel, setTypingModel] = useState(false);

  useEffect(() => {
    getConfig()
      .then((c) => {
        const cfg = c.config;
        setConfig(cfg);
        setPresets(c.presets ?? []);
        setGroups((c.groups as [string, string][]) ?? []);
        setPageCap(cfg.page_cap ?? 60);
        setEngine(cfg.engine === "opencode" ? "opencode" : "openai");
        setOpencodeModel(cfg.opencode?.model ?? "");
        setOpencodeVision(cfg.opencode?.vision ?? true);
        setPreset(cfg.openai?.preset ?? "");
        setBaseUrl(cfg.openai?.base_url ?? "");
        setApi(cfg.openai?.api ?? "chat");
        setApiKey(cfg.openai?.api_key ?? "");
        setModel(cfg.openai?.model ?? "");
        setVision(cfg.openai?.vision ?? false);
        setSavedKeys(cfg.openai?.saved_keys ?? []);
      })
      .catch((e) => push(e instanceof Error ? e.message : "读取配置失败", "err"));
  }, [push]);

  useEffect(() => {
    let alive = true;
    getEngines(true)
      .then((e) => {
        if (!alive) return;
        setFound(e.found);
        setOpencodeModels(e.models?.opencode?.models ?? []);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const opencodeGrouped = useMemo(() => {
    const map = new Map<string, ModelEntry[]>();
    for (const m of opencodeModels) {
      const list = map.get(m.provider) ?? [];
      list.push(m);
      map.set(m.provider, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [opencodeModels]);

  const current = presets.find((p) => p.id === preset);
  const hasKey = (id: string) => savedKeys.includes(id);
  const presetModels = current?.models ?? [];

  /** Switching provider fills in its address, api kind and default model. */
  const pickPreset = (id: string) => {
    const p = presets.find((x) => x.id === id);
    setPreset(id);
    setFetched([]);
    setFetchMsg(null);
    setTypingModel(false);
    if (p) {
      setBaseUrl(p.base_url);
      setApi(p.api ?? "chat");
      const first = p.models?.[0];
      setModel(p.model || first?.id || "");
      setVision(!!(p.models?.find((m) => m.id === (p.model || first?.id))?.vision));
    } else {
      setBaseUrl("");
      setApi("chat");
      setModel("");
      setVision(false);
    }
    setApiKey(hasKey(id) ? "••••" : "");
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
      const patch: Record<string, unknown> = { engine, page_cap: pageCap };
      if (engine === "opencode") {
        patch.opencode = { model: opencodeModel, vision: opencodeVision };
      } else {
        patch.openai = {
          preset,
          base_url: baseUrl.trim(),
          api,
          api_key: apiKey,
          model: model.trim(),
          vision,
        };
      }
      await saveConfig(patch);
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
    try {
      const r = await testEngine(engine);
      push(r.message, r.ok ? "ok" : "err");
    } finally {
      setBusy(false);
    }
  };

  const recommendedIds = presetModels.map((m) => m.id);
  const extraModels = fetched.filter((m) => !recommendedIds.includes(m));
  const showSelect = !typingModel && (recommendedIds.length > 0 || extraModels.length > 0);

  return (
    <div className="dialog-backdrop open" onClick={onClose}>
      <div className="dialog" role="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="vellum-settings">
          <h2>设置</h2>

          <div className="field">
            <span>翻译引擎</span>
            <div className="seg">
              <button className={engine === "openai" ? "on" : ""} onClick={() => setEngine("openai")}>
                API（推荐）
              </button>
              <button className={engine === "opencode" ? "on" : ""} onClick={() => setEngine("opencode")}>
                opencode CLI
              </button>
            </div>
            <p className="hint">
              {engine === "openai"
                ? "直连模型接口，不依赖任何命令行工具。填服务商的地址和 Key 即可。"
                : "用本机已登录的 opencode CLI，不必再填 Key。"}
            </p>
          </div>

          {engine === "openai" ? (
            <>
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
                      onChange={(e) => setBaseUrl(e.target.value)}
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
            </>
          ) : (
            <>
              <div className="field">
                <span>opencode</span>
                <div className="row-line">
                  <span className="grow">
                    {found?.opencode ? (
                      <span style={{ color: "var(--ok)" }}>已找到 {found.opencode.version}</span>
                    ) : (
                      <span style={{ color: "var(--danger)" }}>未找到 opencode 命令</span>
                    )}
                  </span>
                </div>
              </div>
              <label className="field">
                <span>翻译模型</span>
                <select
                  className="input"
                  value={opencodeModel}
                  onChange={(e) => {
                    setOpencodeModel(e.target.value);
                    const picked = opencodeModels.find((m) => m.id === e.target.value);
                    if (picked?.vision !== undefined) setOpencodeVision(picked.vision);
                  }}
                >
                  <option value="">跟随 opencode 默认</option>
                  {opencodeGrouped.map(([provider, list]) => (
                    <optgroup key={provider} label={provider}>
                      {list.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.id}
                          {m.vision ? " · 可看图" : ""}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <p className="hint">
                  读取本机 opencode 配置（共 {opencodeModels.length} 个）。选中的是 opencode 认的
                  provider/model 标识。
                </p>
              </label>
              <label className="field row-line" style={{ display: "flex", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={opencodeVision}
                  onChange={(e) => setOpencodeVision(e.target.checked)}
                />
                <span>该模型能看图</span>
              </label>
            </>
          )}

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

          <div className="actions">
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
