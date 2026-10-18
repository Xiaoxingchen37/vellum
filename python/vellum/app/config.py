"""配置和数据位置。

从源码目录运行时，数据就放在源码目录（library/、config.json）；pip 安装后放在 ~/Vellum。
环境变量 VELLUM_HOME 改数据目录，VELLUM_LIBRARY 临时指定文献库（测试、多库）。
"""
from __future__ import annotations

import copy
import os
from pathlib import Path

from ..engines.presets import PRESET_GROUPS, PRESETS  # noqa: F401
from ..library.store import read_json, write_json_atomic

PACKAGE = Path(__file__).resolve().parent.parent
WEB = PACKAGE / "web"
_SOURCE = PACKAGE.parent
HOME = Path(os.environ.get("VELLUM_HOME") or (_SOURCE if (_SOURCE / "pyproject.toml").exists() else Path.home() / "Vellum"))
PROJECT = HOME  # 旧名，cli 里还在用
CONFIG_PATH = HOME / "config.json"
LOG_PATH = HOME / "vellum.log"
SERVER_INFO = HOME / ".server.json"

DEFAULT_CHAT = {"models": [], "default": ""}

DEFAULTS = {
    "library_dir": str(HOME / "library"),
    "port": 8765,
    # openai（直连任意 OpenAI 兼容接口，默认，不依赖任何 CLI）| none（不翻译）
    "engine": "openai",
    "auto_translate": True,      # 导入后自动开始翻译
    "target": "zh",              # 译文语言，见 langs.py
    "check_updates": False,      # 关闭：Vellum 是本地项目，不查询 easyread 的 Release
    "batch_pages": 2,            # 每次交给模型的页数
    "page_cap": 60,              # 全文超过多少页先确认；0 表示不限
    "concurrency": 0,            # 同时译几段（分段并行，见 segments.py）；0 是自动，每段约 2 批、最多 4 段；手动最多 8 段
    "concurrency_v": 2,          # 1.3.1 起 concurrency 的意思变了，旧配置的 1 当成自动，见 load
    # api：chat（/chat/completions）| responses（/responses）| messages（Anthropic /messages），见 openai_api.py
    "openai": {"preset": "", "base_url": "", "api": "chat", "api_key": "", "model": "", "vision": False, "timeout": 600},
    # 阅读页右侧“问 AI”的模型名单和默认模型，见 chat_models.py
    "chat": copy.deepcopy(DEFAULT_CHAT),
}

def _merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def is_first_run() -> bool:
    return not CONFIG_PATH.exists()


def _saved() -> dict:
    raw = read_json(CONFIG_PATH, {}) or {}
    if raw.get("concurrency_v") != 2 and raw.get("concurrency") == 1:
        # 以前默认 1，而且切到本机 CLI 时设置页会强制改回 1，旧配置里的 1 多半不是自己选的：当成自动。
        # 存过一次之后带上 concurrency_v，再选 1 就是真的要一段一段译
        raw["concurrency"] = 0
    elif raw.get("concurrency_v") != 2 and isinstance(raw.get("concurrency"), int) and raw["concurrency"] > 4:
        raw["concurrency"] = 4  # 以前的 6 是“同时 6 批”，现在是“同时 6 段”：升级时不替老用户开到 4 段以上
    raw["concurrency_v"] = 2
    # opencode CLI 已从产品里去掉：老配置（engine=opencode）自动回到直连 API。
    if raw.get("engine") == "opencode":
        raw["engine"] = "openai"
    raw.pop("opencode", None)  # 已经没有引擎读它了，留着只会让人以为还在用
    # 老版本把“问 AI”的名单写死成 opencode 一项。现在默认引擎是直连 API，这种没动过的名单
    # 会让“问 AI”继续走 opencode；清空它，改由 chat_models 跟随当前翻译引擎。
    chat = raw.get("chat")
    if isinstance(chat, dict) and _legacy_chat(chat.get("models")):
        chat.pop("models", None)
        chat.pop("default", None)
    elif isinstance(chat, dict) and isinstance(chat.get("models"), list):
        # 去掉指向 opencode 的条目；去空了就跟随翻译引擎。
        kept = [m for m in chat["models"] if isinstance(m, dict) and m.get("engine") != "opencode"]
        if len(kept) != len(chat["models"]):
            if kept:
                chat["models"] = kept
                if chat.get("default") and not any(m.get("id") == chat["default"] for m in kept):
                    chat.pop("default", None)
            else:
                chat.pop("models", None)
                chat.pop("default", None)
    return raw


def _legacy_chat(models) -> bool:
    """是不是老版本那个写死的 opencode 默认名单（用户没自己改过）。"""
    return (isinstance(models, list) and len(models) == 1
            and {k: models[0].get(k) for k in ("id", "name", "engine", "model")}
            == {"id": "opencode", "name": "opencode", "engine": "opencode", "model": ""})


def load() -> dict:
    cfg = _merge(DEFAULTS, _saved())
    lib = os.environ.get("VELLUM_LIBRARY")
    if lib:  # 测试或多库时临时指定文献库
        cfg["library_dir"] = lib
    return cfg


def temp_library() -> bool:
    return bool(os.environ.get("VELLUM_LIBRARY"))


def save(patch: dict) -> dict:
    cfg = _merge(_merge(DEFAULTS, _saved()), patch)
    write_json_atomic(CONFIG_PATH, cfg)
    return load()


def with_key(o: dict) -> dict:
    """页面提交的 openai 设置 → 要存的样子。每家服务商的 Key 分开存（keys[预设]），换来换去不用重填；
    页面发回来的打码 Key 或空 Key 表示不改。"""
    cur = load().get("openai") or {}
    o = dict(o)
    key = o.pop("api_key", None)
    preset = o.get("preset", cur.get("preset")) or ""
    keys = dict(cur.get("keys") or {})
    if cur.get("api_key") and not keys:  # 旧配置只有一个 Key
        keys[cur.get("preset") or ""] = cur["api_key"]

    preset_changed = (preset != (cur.get("preset") or ""))
    url_changed = (preset == "" and o.get("base_url", "").strip().rstrip("/") != (cur.get("base_url") or "").strip().rstrip("/"))

    if key and not key.startswith("••••"):
        keys[preset] = key.strip()
    elif url_changed or (preset_changed and preset == "" and (not key or key.startswith("••••"))):
        keys[""] = ""
    o["keys"] = keys
    o["api_key"] = keys.get(preset, "")
    return o


def public(cfg: dict) -> dict:
    """给页面看的配置：密钥只露后四位。"""
    out = copy.deepcopy(cfg)
    key = out["openai"].get("api_key") or ""
    out["openai"]["api_key"] = ("••••" + key[-4:]) if key else ""
    out["openai"]["has_key"] = bool(key)
    out["openai"]["saved_keys"] = [k for k, v in (out["openai"].pop("keys", None) or {}).items() if v]
    return out


def library_dir(cfg: dict | None = None) -> Path:
    p = Path((cfg or load())["library_dir"])
    p.mkdir(parents=True, exist_ok=True)
    return p


def engine_label(cfg: dict) -> str:
    """文献库右上角的引擎标签，如 “DeepSeek · deepseek-flash”。"""
    from .i18n import tr
    e = cfg.get("engine")
    if e == "openai":
        name = next((p["name"] for p in PRESETS if p["id"] == cfg["openai"].get("preset")), "API")
        return f"{name.split('（')[0]} · {cfg['openai'].get('model') or tr('未填模型')}"  # i18n-ok （ 是拆预设名
    return tr("不翻译") if e == "none" else (e or "")
