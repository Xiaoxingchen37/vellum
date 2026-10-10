"""Conversation-local overrides, independent of translation/model-card defaults."""

def apply(ecfg: dict, options: dict | None) -> dict:
    if not isinstance(options, dict):
        return {}
    out = {}
    effort = options.get("reasoning_effort")
    if effort is not None:
        allowed = ["", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]
        engine = ecfg["engine"]
        if engine == "openai":
            allowed = [""]  # 直连接口的推理档位各家不一，先不收窄
        if effort not in allowed:
            raise ValueError("Unsupported reasoning effort")
        ecfg[engine]["reasoning_effort"] = effort
        out["reasoning_effort"] = effort
    return out
