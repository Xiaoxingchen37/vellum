"""翻译 / 回答用的模型后端。

- opencode：本机 opencode CLI 的无头模式（``opencode run``）。这是 Vellum 的主引擎：
  用一个自带的、无工具的翻译 agent（见 opencode_agent.py）调用用户已经登录好的模型，
  不需要在 Vellum 里再填一遍 Key。能看图的模型可以把原页图作为附件发过去核对公式。
- openai：任何 OpenAI 兼容接口（Ollama、智谱、硅基流动、DeepSeek……）作为可选后备，
  在设置里填地址、模型和 Key；Chat Completions 和 Responses 两种格式都行（见 openai_api.py）。
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

from ..app.i18n import tr
from . import netcheck, opencode_agent, usage
from ..app.log import log


class EngineError(RuntimeError):
    pass


class Cancelled(RuntimeError):
    pass


ENGINE_NAMES = {"opencode": "opencode CLI", "openai": "API", "none": "不翻译"}  # i18n-ok 显示时用 engine_name()


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
    engine = cfg.get("engine")
    if engine == "opencode":
        return run_opencode(cfg["opencode"], prompt, images or [], cancel, meter)
    if engine == "openai":
        return run_openai(cfg["openai"], prompt, images or [], cancel, meter)
    raise EngineError(tr("没有配置翻译引擎（设置 → 模型）"))


def image_mode(cfg: dict) -> str:
    """提示词里怎么说原页图：opencode 的翻译 agent 没有工具，看图的模型只能靠附件；
    不能看图就是纯文本。"""
    engine = cfg.get("engine")
    if engine == "opencode":
        return "attached" if cfg["opencode"].get("vision") else "text"
    if engine == "openai" and cfg["openai"].get("vision"):
        return "attached"
    return "text"


def who(cfg: dict) -> str:
    engine = cfg.get("engine")
    if engine == "openai":
        return cfg["openai"].get("model") or "API"
    if engine == "opencode":
        return cfg["opencode"].get("model") or "opencode"
    return ""


# ---------- 本机 opencode CLI ----------
_NO_WINDOW = 0x08000000 if hasattr(subprocess, "CREATE_NO_WINDOW") else 0


def opencode_path(c: dict) -> str | None:
    return shutil.which(c.get("command") or "opencode")


def _opencode_home() -> Path:
    """opencode 的专用工作目录：放翻译 agent，也当调用时的 cwd。

    放在 Vellum 数据目录下，和用户自己的项目、全局 AGENTS.md 隔开——翻译不该被项目
    上下文污染。
    """
    from ..app import config
    return config.HOME


def _popen(args: list[str], cwd: Path):
    return subprocess.Popen(args, cwd=str(cwd), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, encoding="utf-8", errors="replace", creationflags=_NO_WINDOW,
                            env=netcheck.proxy_env())


def run_opencode(c: dict, prompt: str, images: list[Path], cancel=None, meter=None) -> str:
    """用自带的翻译 agent 跑一次 opencode，返回纯文本结果。

    prompt 走 stdin：整篇翻译的提示词（含原页文字、术语表、前文参考）轻松超过 Windows
    命令行 32KB 上限，只有标准输入能稳定送进去。

    默认加 ``--standalone``：opencode 的 ``run`` 默认要连（或抢占）它自己的后台托管服务，
    而该服务往往已被用户日常使用的 opencode 占住 49374 端口，于是每次调用都要重试约 25 秒
    再失败。``--standalone`` 让这次调用起一个私有服务，既不抢端口，也就没有那段等待。
    """
    exe = opencode_path(c)
    if not exe:
        raise EngineError(tr("找不到 opencode 命令：{cmd}（先安装 opencode CLI）", cmd=c.get("command") or "opencode"))
    home = _opencode_home()
    agent = opencode_agent.ensure(home)
    args = [exe, "run", "--agent", agent, "--format", "json"]
    if c.get("standalone", True):
        args.append("--standalone")
    if c.get("model"):
        args += ["--model", c["model"]]
    for img in images:
        args += ["--file", str(img)]
    args += list(c.get("extra_args") or [])
    out = _communicate(_popen(args, home), prompt, int(c.get("timeout") or 1200), cancel)
    return _parse_opencode(out, meter)


def _parse_opencode(out: str, meter) -> str:
    """opencode ``--format json`` 每行一个事件；拼起所有 text part，顺便收 token 用量。

    出错时抛 EngineError，把 opencode 报的 message 原样带出来——限流、模型不可用、
    地区限制这些都要让用户看得到。
    """
    parts: list[str] = []
    err = ""
    for ev in _json_lines(out):
        kind = ev.get("type")
        if kind == "text":
            text = (ev.get("part") or {}).get("text")
            if isinstance(text, str):
                parts.append(text)
        elif kind == "step_finish" and meter is not None:
            meter.add(**usage.from_opencode(ev.get("part") or {}))
        elif kind == "error":
            e = ev.get("error") or {}
            err = str(e.get("message") or e.get("name") or e)
    text = "".join(parts).strip()
    if err and not text:
        raise EngineError(tr("opencode 出错：{msg}", msg=err[:500]))
    if not text:
        raise EngineError(tr("opencode 没有给出结果：{out}", out=(out or "")[-300:]))
    return text


def _json_lines(out: str) -> list[dict]:
    """CLI 一行一个 JSON 事件；夹杂的非 JSON 行跳过。"""
    events = []
    for line in (out or "").splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return events


def _communicate(proc, stdin_text: str, timeout: int, cancel) -> str:
    result = {}

    def talk():
        result["out"], result["err"] = proc.communicate(stdin_text)

    t = threading.Thread(target=talk, daemon=True)
    t.start()
    waited = 0.0
    while t.is_alive():
        t.join(0.5)
        waited += 0.5
        if cancel is not None and cancel.is_set():
            proc.kill()
            raise Cancelled()
        if waited > timeout:
            proc.kill()
            raise EngineError(tr("超过 {n} 秒没有结果", n=timeout))
    if proc.returncode not in (0, None) and not result.get("out"):
        raise EngineError((result.get("err") or "")[-500:] or tr("退出码 {code}", code=proc.returncode))
    return result.get("out", "")


def for_translation(cfg: dict) -> dict:
    """翻译、问 AI、回答笔记、重译一段都走这里。

    opencode 的翻译 agent 本身就没有工具，不需要再额外收窄；保留这个函数是为了让调用方
    的接口不变（历史上 Claude/Codex 要在这里关掉 MCP 和多余工具）。
    """
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


def _version(exe: str) -> str:
    try:
        return subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=30,
                              creationflags=_NO_WINDOW).stdout.strip().splitlines()[0]
    except Exception:  # noqa: BLE001
        return ""


def test(cfg: dict) -> dict:
    """设置页“测试”按钮：真的让模型回一句，确认引擎能用。"""
    engine = cfg.get("engine")
    if engine == "opencode" and not opencode_path(cfg["opencode"]):
        return {"ok": False, "message": tr("找不到 opencode 命令，先安装并登录")}
    if engine == "none":
        return {"ok": True, "message": tr("未启用自动翻译")}
    try:
        out = run(cfg, '只回复 JSON，不要别的文字：{"ok": true}', Path(tempfile.gettempdir()), None, None)  # i18n-ok
        parse_json(out)
        return {"ok": True, "message": tr("可以用：{out}", out=out.strip()[:40])}
    except (EngineError, Cancelled) as e:
        return {"ok": False, "message": str(e)[:300]}
