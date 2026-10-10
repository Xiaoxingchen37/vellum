# Vellum

本地优先的文献翻译阅读器。导入英文 PDF，用本机解析器读出带坐标与公式的结构，
再用大模型逐段翻译，最后按原页坐标排成中文，并提供左英右中的对照阅读。

## 它能做什么

- **导入 PDF**：拖拽或文件选择，论文自动进入本地文献库
- **本机解析**：用 PDFium / PyMuPDF 在本机抽文字、图表边界和字符坐标，不需要云服务
- **逐段翻译**：只翻译自然语言，公式与代码原样保留；翻译结果本地缓存、可断点续跑
- **对照阅读**：左边原文页带高亮框，点一下跳到右边对应译文；点译文反向定位原文
- **边读边问**：选中一段就能问 AI，读文献时带着上下文追问

## 架构

```
Tauri (React + TS)          界面：文献库 / 对照阅读 / 设置
      │ IPC
      ▼
Rust 外壳                    窗口、侧车生命周期、端口发现、健康检查
      │ spawn vellum-sidecar.exe（打包版）或 python -m vellum（开发版）
      ▼
Python 侧车 (FastAPI)        本机 PDF 解析 + 三协议 LLM 层 + 翻译 + 渲染
```

打包版把 Python 后端冻结成 `vellum-sidecar.exe` 一起装进去，**目标机器不需要装 Python**。

## 翻译协议支持

翻译层直连三家主流协议，不依赖各家 SDK，也**不需要装任何 CLI**：

| 协议 | 路径 | 认证 | 说明 |
|---|---|---|---|
| `chat_completions` | `/chat/completions` | `Bearer` | OpenAI 及 DeepSeek / Kimi / GLM / 千问 / 硅基流动 / 火山 等兼容端点 |
| `responses` | `/responses` | `Bearer` | OpenAI Responses API |
| `messages` | `/messages` | `x-api-key` | Anthropic Messages API（`max_tokens` 必填，已内置默认值） |

适配器会自动处理推理模型泄漏的 `reasoning_content`、多模态数组 content、
Responses 的异构 `output` 列表与 Anthropic 的类型化内容块。

设置页内置常见服务商预设（国内直连 / 海外 / 本机 Ollama、LM Studio），Key 按服务商分别保存，
可一键「获取模型列表」。

## 引擎：直连 API 或 opencode CLI

翻译走**直连 API**：填服务商地址 + Key 就能用，只要接口兼容上面三种协议之一即可，
包括中转站和本机 Ollama。不依赖 opencode、Claude Code 等任何命令行工具。

设置页里没有单独配置"问 AI"的模型名单时，它会自动跟随翻译引擎。

## 数据保存位置

文献库默认在 `%LOCALAPPDATA%\Vellum\library`。在**设置 → 数据保存位置**里可以改到任意文件夹
（比如网盘同步目录）：已有论文会整库复制过去，旧文件夹保留不删，改完应用自动重启生效。

打包版把 Python 后端冻结成了 `vellum-sidecar.exe` 一起装进去，**目标机器不需要装 Python**。

## 环境

- Node.js 20+、Rust stable（MSVC 工具链）、TAURI 所需的 C++ Build Tools
- Python 3.12（建议独立 conda 环境，本仓库开发时使用名为 `vellum` 的环境）

```powershell
conda create -n vellum python=3.12 -y
conda activate vellum
pip install pypdfium2 PyMuPDF pypdf pdfplumber pillow certifi truststore
```

Rust 侧默认会在 `E:\miniforge3\envs\vellum` 等常见路径下查找解释器，
也可以用环境变量 `VELLUM_PYTHON` 显式指定 Python 可执行文件。

## 运行

```powershell
npm install
npm run tauri dev
```

## 打包

```powershell
# 1) 先冻结 Python 后端（需要装了 vellum 依赖的环境 + pip install pyinstaller）
python build_sidecar.py
# 2) 再打 MSI（会把 vellum-sidecar.exe 一起打包）
npm run tauri build
```

产物：`src-tauri/target/release/bundle/msi/Vellum_0.2.0_x64_en-US.msi`。
安装需要管理员权限（写 Program Files），装完不需要额外装 Python。

**免安装用法**：把 `src-tauri/target/release/vellum.exe` 和
`src-tauri/binaries/vellum-sidecar.exe` 按下面的结构放好，双击 `vellum.exe` 即可：

```
Vellum\
  vellum.exe
  binaries\vellum-sidecar.exe
```

## Python 侧车单独调试

```powershell
$env:PYTHONPATH="D:\PythonProject\Vellum\python"
$env:VELLUM_LIBRARY="D:\VellumLibrary"
& <python> -m uvicorn vellum.server:app --host 127.0.0.1 --port 8791
```

主要接口：`/health`、`/presets`、`/import`、`/run`、`/jobs/{id}`、
`/jobs/{id}/progress`（SSE）、`/projects`、`/projects/{id}/blocks`、
`/projects/{id}/file/{name}`。

## 数据位置

文献库默认位于 `%LOCALAPPDATA%\Vellum\library`，每篇论文一个自包含目录：

```
papers/<id>/
  source.pdf              原始 PDF
  paper.json              结构化的原文与译文（对照阅读的数据源）
  reader.json             你的译文修改、划线、笔记
  item.json               标签、阅读状态、星标
  blocks.json             对照阅读用的块列表
  translation_cache.json  翻译缓存
  meta.json                元数据
```

也可以在应用里**设置 → 数据保存位置**把整个文献库换到别的文件夹（比如网盘同步目录），
已有论文会整库复制过去，旧文件夹保留不删。

API Key 保存在本机的 `config.json`（`%LOCALAPPDATA%\Vellum\config.json`），按服务商分别存放，
不会写入文献库，也不会随论文导出。

## 许可证

本项目基于 MIT 许可证，见 `LICENSE`。

后端与阅读界面移植自 [easyread](https://github.com/Edwardxlai/easyread)（MIT），
在其基础上改用 opencode CLI / 直连 API、并加了 Tauri + React 桌面外壳，出处见 `NOTICE`。

第三方组件许可见 `THIRD_PARTY_LICENSES.md`。
