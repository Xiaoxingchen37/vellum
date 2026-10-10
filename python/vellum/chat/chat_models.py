"""“问 AI”用哪些模型：设置里一张短名单，可以增删改。

每一项：{"id", "name", "engine": "openai", "model", "preset"（API 服务商）, "base_url"（自定义地址时）,
         "api"（chat | responses | messages，不填跟服务商默认）}
API 的 Key 用翻译引擎那边按服务商存的同一份（openai.keys），不用填两次。
"""
from __future__ import annotations

import copy
import re
from pathlib import Path

from ..engines import engines
from ..engines.presets import PRESETS
from ..app.i18n import tr

# 默认空名单：没有单独配“问 AI”用哪些模型时，直接跟随当前翻译引擎（见 from_engine）。
# 这样只配了一个接口，边读边问 AI 也能用。
DEFAULT_MODELS: list[dict] = []
_SEEN_PATH = None  # config.HOME / ".models-seen.json"，懒加载避免循环导入


def _seen_path():
    from ..app import config
    return config.HOME / ".models-seen.json"


def pretty(model_id: str) -> str:
    """provider/model → model 部分；其余原样。"""
    return model_id.split("/", 1)[1] if "/" in (model_id or "") else (model_id or "")


def remember(alias: str, actual: str) -> None:
    """记下别名实际对应的模型（保留接口，当前引擎暂不需要）。"""
    if not alias or not actual or alias == actual:
        return
    from ..library.store import read_json, write_json_atomic
    seen = read_json(_seen_path(), {}) or {}
    if seen.get(alias) != actual:
        seen[alias] = actual
        write_json_atomic(_seen_path(), seen)


def actual_of(alias: str) -> str:
    from ..library.store import read_json
    return (read_json(_seen_path(), {}) or {}).get(alias, "")


DEFAULT_CHAT = {"models": [], "default": ""}


def from_engine(cfg: dict) -> dict:
    """把当前翻译引擎当作一个对话模型。名单为空时用它，省得用户配两遍。"""
    o = cfg.get("openai") or {}
    return {"id": "translate", "name": tr("跟随翻译引擎"), "engine": "openai", "preset": o.get("preset", ""),
            "base_url": o.get("base_url", ""), "model": o.get("model", ""), "api": o.get("api", "")}


def models(cfg: dict) -> list[dict]:
    ms = list((cfg.get("chat") or {}).get("models") or [])
    return ms or [from_engine(cfg)]


def find(cfg: dict, mid: str | None) -> dict:
    ms = models(cfg)
    want = mid or (cfg.get("chat") or {}).get("default")
    return next((m for m in ms if m.get("id") == want), ms[0] if ms else from_engine(cfg))


def _key(cfg: dict, preset: str) -> str:
    o = cfg["openai"]
    keys = dict(o.get("keys") or {})
    if o.get("api_key"):
        keys.setdefault(o.get("preset") or "", o["api_key"])
    return keys.get(preset or "", "")


def engine_cfg(cfg: dict, mid: str | None) -> tuple[dict, dict]:
    """名单里的一项 → (engines 认的配置, 这一项)。"""
    m = find(cfg, mid)
    out = copy.deepcopy(cfg)
    out["engine"] = m["engine"]
    if m["engine"] == "openai":
        p = next((x for x in PRESETS if x["id"] == m.get("preset")), None)
        out["openai"] = {**out["openai"], "preset": m.get("preset") or "", "vision": False,
                         "base_url": m.get("base_url") or (p["base_url"] if p else out["openai"].get("base_url", "")),
                         "model": m.get("model") or (p["model"] if p else ""), "api_key": _key(cfg, m.get("preset") or ""),
                         "api": m.get("api") or (p or {}).get("api") or "chat",
                         "reasoning_effort": m.get("reasoning_effort") or "", "service_tier": m.get("service_tier") or ""}
    else:
        raise engines.EngineError(tr("不认识的模型来源：{engine}", engine=m.get("engine")))
    return out, m


def translation_id(cfg: dict) -> str:
    """名单里哪一张就是翻译用的那个模型（设置里标着“翻译”的卡片）；对不上返回空。"""
    if cfg.get("engine") != "openai":
        return ""
    o = cfg.get("openai", {})
    for m in models(cfg):
        if m.get("engine") == "openai" and (m.get("preset") or "") == (o.get("preset") or "") \
                and (m.get("model") or "") == (o.get("model") or ""):
            return m["id"]
    return ""


def label(m: dict) -> str:
    """面板上显示的名字。"""
    return m.get("name") or pretty(m.get("model") or "") or tr("模型")


def listing(cfg: dict) -> dict:
    """给页面：名单 + 每项能不能用、来源说明。"""
    from ..engines.detect import detect, needs_key
    out = []
    for m in models(cfg):
        p = next((x for x in PRESETS if x["id"] == m.get("preset")), None)
        ready = bool(_key(cfg, m.get("preset") or "")) or not needs_key({"preset": m.get("preset"), "base_url": m.get("base_url", "")})
        source = p["name"] if p else tr("自定义地址")
        hint = "" if ready else tr("还没填 {source} 的 Key（设置 → 模型 → 点这张卡片 → 修改）", source=source)
        out.append({**m, "label": label(m), "source": source, "ready": ready, "hint": hint,
                    "detail": m.get("model") or ""})
    default = (cfg.get("chat") or {}).get("default") or (out[0]["id"] if out else "")
    return {"models": out, "default": default, "translate": translation_id(cfg), "presets": [{"id": p["id"], "name": p["name"], "models": p.get("models", []), "api": p.get("api", "chat")} for p in PRESETS]}


def sanitize(items: list[dict]) -> list[dict]:
    """设置页提交的名单：去掉空项、补 id。"""
    out, seen = [], set()
    for k, m in enumerate(items or []):
        if m.get("engine") != "openai" or not (m.get("preset") or m.get("base_url")):
            continue
        mid = re.sub(r"[^\w\-]", "-", str(m.get("id") or f"m{k}"))[:40] or f"m{k}"
        while mid in seen:
            mid += "-2"
        seen.add(mid)
        out.append({"id": mid, "name": str(m.get("name") or m.get("model") or tr("模型"))[:40], "engine": "openai",
                    "model": str(m.get("model") or "")[:120], "preset": str(m.get("preset") or ""), "base_url": str(m.get("base_url") or "")[:300],
                    "api": m.get("api") if m.get("api") in ("chat", "responses", "messages") else ""})
    return out
