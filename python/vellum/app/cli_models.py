"""opencode CLI 能选哪些模型，给设置页的下拉框用。

模型名单直接解析 opencode 自己的配置文件（见 opencode_config.py）：不拉子进程、
不抢占它的后台服务，瞬间就能列全。下拉框里每一项的 value 就是
``opencode run --model`` 认的 ``provider/model``，选中的一定是能用的。
"""
from __future__ import annotations

import subprocess
import threading
import time

from ..engines import engines, opencode_config
from .i18n import tr
from .log import log

_NO_WINDOW = 0x08000000 if hasattr(subprocess, "CREATE_NO_WINDOW") else 0
_cache: dict = {"at": 0.0, "models": []}
_lock = threading.Lock()
_TTL = 30


def models(cfg: dict | None = None, fresh: bool = False) -> list[dict]:
    with _lock:
        if not fresh and _cache["models"] and time.time() - _cache["at"] < _TTL:
            return _cache["models"]
    out = opencode_config.models()
    with _lock:
        _cache.update(at=time.time(), models=out)
    return out


def probe_opencode(c: dict, version: str) -> None:
    """服务启动时后台刷一次（配置改了会变）。"""
    models({"opencode": c}, fresh=True)


def listing() -> dict:
    return {"opencode": {"models": models()}}


def engine_label(cfg: dict) -> str:
    """文献库右上角的引擎标签：“opencode · workbuddy/global:deepseek-v4.1-flash”。"""
    e = cfg.get("engine")
    if e == "openai":
        from ..engines.presets import PRESETS
        preset = next((p["name"] for p in PRESETS if p["id"] == cfg["openai"].get("preset")), "API")
        return f"{preset.split('（')[0]} · {cfg['openai'].get('model') or tr('未填模型')}"  # i18n-ok （ 是拆预设名
    name = engines.engine_name(e)
    if e == "opencode":
        model = cfg["opencode"].get("model") or tr("跟随 opencode 默认")
        return f"{name} · {model}"
    return name
