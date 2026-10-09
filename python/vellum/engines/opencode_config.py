"""List the models available to the local opencode CLI, straight from its config.

``opencode models`` is not usable here: it insists on owning its background
service, which collides with the already-running managed service (25s of retry,
then failure). The config file is the same source of truth, needs no subprocess,
and answers instantly — which is what the settings page wants.

Two files are merged the way opencode itself merges them: ``opencode.json`` first,
then ``opencode.jsonc`` (which may add providers and instructions). Built-in
providers (opencode/*, plus anything models.dev knows) cannot be enumerated from
config alone, so they are listed as a fallback group.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

# Providers opencode ships with. Their models come from the models.dev catalogue
# rather than the config file, so we surface them without pretending to know the
# full list.
BUILTIN_PROVIDERS = ["opencode"]

_CONFIG_CACHE: dict[str, dict] = {"at": 0.0, "models": []}
_TTL = 30.0


def config_dir() -> Path:
    """opencode's config directory (honours XDG_CONFIG_HOME)."""
    override = os.environ.get("OPENCODE_CONFIG_DIR")
    if override:
        return Path(override)
    return Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "opencode"


def _read_jsonc(path: Path) -> dict:
    """Read a JSON file, tolerating // and /* */ comments and trailing commas."""
    try:
        text = path.read_text(encoding="utf-8-sig")
    except OSError:
        return {}
    text = re.sub(r"/\*[\s\S]*?\*/", "", text)
    text = re.sub(r"(^|\s)//[^\n]*", r"\1", text)
    text = re.sub(r",(\s*[}\]])", r"\1", text)
    try:
        data = json.loads(text)
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def load_config() -> dict:
    """Merge opencode's config sources the way opencode does.

    ``provider`` must be merged key by key: the .jsonc file adds providers on top
    of the .json ones rather than replacing the whole map, otherwise everything
    declared in opencode.json silently disappears.
    """
    merged: dict = {}
    for name in ("opencode.json", "opencode.jsonc"):
        data = _read_jsonc(config_dir() / name)
        for key, value in data.items():
            if key == "provider" and isinstance(value, dict):
                providers = merged.setdefault("provider", {})
                for provider, spec in value.items():
                    if isinstance(spec, dict) and isinstance(providers.get(provider), dict):
                        providers[provider].update(spec)
                    else:
                        providers[provider] = spec
            else:
                merged[key] = value
    return merged


def models(refresh: bool = False) -> list[dict]:
    """[{"id": "provider/model", "name", "provider", "vision"}] from opencode's config.

    ``id`` is exactly what ``opencode run --model`` expects, so anything picked
    from this list is guaranteed to resolve. ``vision`` reflects the model's
    declared input modalities.
    """
    import time

    if not refresh and _CONFIG_CACHE["models"] and time.time() - _CONFIG_CACHE["at"] < _TTL:
        return _CONFIG_CACHE["models"]

    out: list[dict] = []
    seen: set[str] = set()
    cfg = load_config()
    for provider, spec in (cfg.get("provider") or {}).items():
        if not isinstance(spec, dict):
            continue
        for model_id, meta in (spec.get("models") or {}).items():
            full = f"{provider}/{model_id}"
            if full in seen:
                continue
            seen.add(full)
            meta = meta if isinstance(meta, dict) else {}
            name = str(meta.get("name") or model_id)
            modalities = (meta.get("modalities") or {}).get("input") or []
            out.append({
                "id": full,
                "name": name,
                "provider": str(provider),
                "vision": "image" in modalities,
            })

    _CONFIG_CACHE.update(at=time.time(), models=out)
    return out


def default_model() -> str:
    """The model opencode would use when none is given, if we can tell."""
    cfg = load_config()
    small = cfg.get("small_model")
    return str(small) if isinstance(small, str) else ""
