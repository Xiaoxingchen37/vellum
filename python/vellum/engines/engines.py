"""翻译 / 回答用的模型后端：直连 OpenAI 兼容接口（见 openai_api.py）。

支持 Chat Completions、Responses 与 Anthropic Messages 三种协议，包括本机 Ollama、
LM Studio 和各家云服务商；设置里填地址、模型和 Key 即可，不依赖任何命令行工具。
"""
from __future__ import annotations

import json
import re
import tempfile
import threading
from pathlib import Path

from ..app.i18n import tr
from . import netcheck, usage


class EngineError(RuntimeError):
    pass


class Cancelled(RuntimeError):
    pass


ENGINE_NAMES = {"openai": "API", "none": "不翻译"}  # i18n-ok 显示时用 engine_name()


def engine_name(engine: str | None) -> str:
    return tr("不翻译") if engine == "none" else ENGINE_NAMES.get(engine, engine or "")


def run(cfg: dict, prompt: str, cwd: Path, images: list[Path] | None = None, cancel: threading.Event | None = None,
        meter: usage.Meter | None = None) -> str:
    """meter：传了就把这次调用的 token 用量记进去（整篇翻译时用）。"""
    bad = netcheck.problem(cfg)
    if bad:
        raise EngineError(bad)
    try:
        return _run(cfg, prompt, cwd, images, cancel, meter)
    except EngineError as e:
        raise EngineError(netcheck.explain(cfg, str(e))) from None


def _run(cfg: dict, prompt: str, cwd: Path, images: list[Path] | None, cancel: threading.Event | None, meter) -> str:
    if cfg.get("engine") == "openai":
        return run_openai(cfg["openai"], prompt, images or [], cancel, meter)
    raise EngineError(tr("没有配置翻译引擎（设置 → 模型）"))


def image_mode(cfg: dict) -> str:
    """提示词里怎么说原页图：模型能看图就把原页图作为附件发过去，否则纯文本。"""
    return "attached" if cfg.get("engine") == "openai" and cfg["openai"].get("vision") else "text"


def who(cfg: dict) -> str:
    return cfg["openai"].get("model") or "API" if cfg.get("engine") == "openai" else ""


def for_translation(cfg: dict) -> dict:
    """翻译、问 AI、回答笔记、重译一段都走这里。保留这个函数是为了让调用方的接口稳定。"""
    return dict(cfg)


# ---------- OpenAI 兼容接口 ----------
def run_openai(c: dict, prompt: str, images: list[Path], cancel=None, meter=None) -> str:
    from . import openai_api  # 它要用本文件的 EngineError，放这里免得循环导入
    return openai_api.complete(c, prompt, images, cancel, meter)


def parse_json(text: str):
    """从模型输出里取出 JSON（容忍 ```json 围栏和前后废话）。"""
    t = re.sub(r"<think>[\s\S]*?</think>", "", text).strip()  # 推理模型（deepseek-r1、qwen3）先输出的思考过程
    # 先取最外层的 { … }：译文里可能本身带代码块（论文附录的 PyTorch 代码），按 ``` 围栏切会切到半截
    bodies = []
    for s in (t, *(m.group(1).strip() for m in re.finditer(r"```(?:json)?\s*([\s\S]*?)```", t))):
        start = min([i for i in (s.find("{"), s.find("[")) if i >= 0], default=-1)
        if start >= 0:
            bodies.append(s[start:max(s.rfind("}"), s.rfind("]")) + 1])
    if not bodies:
        raise EngineError(tr("模型输出里没有 JSON：{text}", text=text[:200]))
    first = None
    for body in bodies:
        try:
            return json.loads(body)
        except json.JSONDecodeError as e:
            first = first or e
    body = bodies[0]
    # 常见毛病：TeX 反斜杠没写成两个（\alpha、\sum）、字符串里有原样换行
    fixed = re.sub(r'\\(?!["\\/bfnrtu])', r"\\\\", body)
    try:
        return json.loads(fixed, strict=False)
    except json.JSONDecodeError:
        raise EngineError(tr("模型输出的 JSON 格式有错（{err}），会自动重试", err=first))


def test(cfg: dict) -> dict:
    """设置页“测试”按钮：真的让模型回一句，确认引擎能用。"""
    engine = cfg.get("engine")
    if engine == "none":
        return {"ok": True, "message": tr("未启用自动翻译")}
    try:
        out = run(cfg, '只回复 JSON，不要别的文字：{"ok": true}', Path(tempfile.gettempdir()), None, None)  # i18n-ok
        parse_json(out)
        return {"ok": True, "message": tr("可以用：{out}", out=out.strip()[:40])}
    except (EngineError, Cancelled) as e:
        return {"ok": False, "message": str(e)[:300]}
