"""看看这台机器上有没有本机 Ollama。给设置页和首次引导用。"""
from __future__ import annotations

import json
import threading
import time
import urllib.request

_cache: dict = {}
_lock = threading.Lock()


def _ollama() -> dict:
    try:
        with urllib.request.urlopen("http://127.0.0.1:11434/api/tags", timeout=1.5) as r:
            models = [m.get("name") for m in json.loads(r.read()).get("models", []) if m.get("name")]
        return {"running": True, "models": models}
    except Exception:  # noqa: BLE001
        return {"running": False, "models": []}


def detect(cfg: dict, fresh: bool = False) -> dict:
    """查一次本机 Ollama（约 1.5 秒超时）。有缓存就直接给，过期了在后台刷新，页面不用等。"""
    with _lock:
        cached = _cache.get("data")
        if cached and not fresh:
            if time.time() - _cache["at"] > 300 and not _cache.get("busy"):
                _cache["busy"] = True
                threading.Thread(target=_refresh, args=(cfg,), daemon=True).start()
            return cached
    return _refresh(cfg)


def warm(cfg: dict) -> None:
    """服务启动时先在后台查一遍，第一次打开设置就不用等。"""
    threading.Thread(target=_refresh, args=(cfg,), daemon=True).start()


def _refresh(cfg: dict) -> dict:
    out = {"ollama": _ollama()}
    with _lock:
        _cache.update(at=time.time(), data=out, busy=False)
    return out


def needs_key(o: dict) -> bool:
    from .presets import PRESETS
    p = next((x for x in PRESETS if x["id"] == o.get("preset")), None)
    if p:
        return p["key"]
    return not any(h in (o.get("base_url") or "") for h in ("127.0.0.1", "localhost"))


def ready(cfg: dict, found: dict) -> bool:
    """当前选的引擎看起来能用吗（首次引导据此提示）。"""
    if cfg.get("engine") == "openai":
        o = cfg["openai"]
        return bool(o.get("base_url") and o.get("model") and (o.get("api_key") or not needs_key(o)))
    return True
