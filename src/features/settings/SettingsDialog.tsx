import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { getConfig, getEngines, saveConfig, testEngine } from "../../api/vellum";
import type { ConfigResponse, EnginesResponse } from "../../api/types";
import { useToast } from "../../components/Toast";

type Props = {
  onClose: () => void;
  onSaved: () => void;
};

type ModelEntry = { id: string; name: string; provider: string; vision?: boolean };

export function SettingsDialog({ onClose, onSaved }: Props) {
  const [config, setConfig] = useState<ConfigResponse["config"] | null>(null);
  const [found, setFound] = useState<EnginesResponse["found"] | null>(null);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [model, setModel] = useState("");
  const [pageCap, setPageCap] = useState(60);
  const [vision, setVision] = useState(true);
  const [busy, setBusy] = useState(false);
  const { push } = useToast();

  useEffect(() => {
    getConfig().then((c) => {
      setConfig(c.config);
      setModel(c.config.opencode?.model ?? "");
      setPageCap(c.config.page_cap ?? 60);
      setVision(c.config.opencode?.vision ?? true);
    });
  }, []);

  useEffect(() => {
    let alive = true;
    getEngines(true)
      .then((e) => {
        if (!alive) return;
        setFound(e.found);
        setModels(e.models?.opencode?.models ?? []);
        // Follow the selected model's own declared vision support, unless the
        // user has already overridden it.
        const picked = (e.models?.opencode?.models ?? []).find((m) => m.id === model);
        if (picked?.vision !== undefined) setVision(picked.vision);
      })
      .catch((e) => push(e instanceof Error ? e.message : "读取模型列表失败", "err"));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, ModelEntry[]>();
    for (const m of models) {
      const list = map.get(m.provider) ?? [];
      list.push(m);
      map.set(m.provider, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [models]);

  const onPick = (id: string) => {
    setModel(id);
    const picked = models.find((m) => m.id === id);
    if (picked?.vision !== undefined) setVision(picked.vision);
  };

  const save = async () => {
    setBusy(true);
    try {
      await saveConfig({
        engine: "opencode",
        page_cap: pageCap,
        opencode: { model, vision },
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
    try {
      const r = await testEngine("opencode");
      push(r.message, r.ok ? "ok" : "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop open" onClick={onClose}>
      <div className="dialog" role="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="vellum-settings">
          <h2>设置</h2>

          <div className="field">
            <span>翻译引擎</span>
            <div className="row-line">
              <span className="grow">
                opencode CLI{" "}
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
            <select className="input" value={model} onChange={(e) => onPick(e.target.value)}>
              <option value="">跟随 opencode 默认</option>
              {grouped.map(([provider, list]) => (
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
              直接读取你本机 opencode 的配置（共 {models.length} 个）。选中的是 opencode 认的
              provider/model 标识，点击即可用。
            </p>
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

          <label className="field row-line" style={{ display: "flex", gap: 8 }}>
            <input type="checkbox" checked={vision} onChange={(e) => setVision(e.target.checked)} />
            <span>该模型能看图（把 PDF 原页图作为附件发给模型核对公式）</span>
          </label>

          <div className="actions">
            <button className="btn line" onClick={test} disabled={busy}>
              测试引擎
            </button>
            <button className="btn" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button className="btn accent" onClick={save} disabled={busy}>
              {busy && <Loader2 size={14} className="spin" />} 保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
