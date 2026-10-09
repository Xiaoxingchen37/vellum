"""Conversation-local overrides, independent of translation/model-card defaults."""
from ..app import cli_models


def apply(ecfg: dict, options: dict | None) -> dict:
    if not isinstance(options, dict):
        return {}
    out = {}
    effort = options.get("reasoning_effort")
    if effort is not None:
        allowed = ["", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]
        engine = ecfg["engine"]
        # opencode 的推理档位取决于具体模型（variants），不在这里硬编码校验。
        if engine == "openai":
            allowed = [""]
        if effort not in allowed:
            raise ValueError("Unsupported reasoning effort")
        ecfg[engine]["reasoning_effort"] = effort
        out["reasoning_effort"] = effort
    return out
