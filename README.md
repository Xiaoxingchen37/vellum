# Vellum

本地优先的文献翻译阅读器。导入英文 PDF，调用 MinerU 解析结构，用大模型逐段翻译，
再按原始页面坐标渲染出**排版一致、公式可复制**的中文 PDF，并提供左英右中的对照阅读。

## 它能做什么

- **导入 PDF**：拖拽或文件选择，论文自动进入本地文献库
- **MinerU 解析**：调用 MinerU 云 API，得到带坐标与 LaTeX 公式的结构化 `middle.json`
- **逐段翻译**：只翻译自然语言 span，公式与代码原样保留；翻译结果本地缓存、可断点续跑
- **生成中文 PDF**：优先用 MinerU 的 `PdfLayout.ORIGINAL` 渲染（文字可选中、公式为矢量），
  失败时自动回退到 PyMuPDF 覆盖渲染
- **对照阅读**：左侧原文 PDF 带可点击高亮框，点击即跳到右侧对应译文；点击译文反向定位原文

## 架构

```
Tauri (React + TS)          界面：文献库 / 对照阅读 / 设置
      │ IPC
      ▼
Rust 外壳                    窗口、侧车生命周期、端口发现、健康检查
      │ spawn uvicorn
      ▼
Python 侧车 (FastAPI)        MinerU 客户端 + 三协议 LLM 层 + 翻译 + 渲染
```

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

翻译引擎二选一，默认是**直连 API**：

- **API（默认）**：填服务商地址 + Key 就能用。只要接口兼容上面三种协议之一即可，
  包括中转站和本机 Ollama。
- **opencode CLI（可选）**：复用本机已登录的 opencode，不必再填 Key。
  调用时每次起一个私有服务（`--standalone`），不去抢占它自己的后台服务。

两条路都支持"边读边问 AI"；没有单独配置问 AI 的模型名单时，会自动跟随翻译引擎。

## 环境

- Node.js 20+、Rust stable（MSVC 工具链）、TAURI 所需的 C++ Build Tools
- Python 3.12（建议独立 conda 环境，本仓库开发时使用名为 `vellum` 的环境）

```powershell
conda create -n vellum python=3.12 -y
conda activate vellum
pip install fastapi "uvicorn[standard]" httpx PyMuPDF requests jinja2 python-multipart
pip install "mineru>=4.0,<5"
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
npm run tauri build
```

产物：`src-tauri/target/release/bundle/msi/Vellum_0.1.0_x64_en-US.msi`

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
  middle.json             MinerU 解析结果
  middle.translated.json  译文回填后的结构
  blocks.json             对照阅读用的块列表
  translation_cache.json  翻译缓存
  translated.pdf          生成的中文 PDF
  meta.json                元数据
```

API Key 保存在本机的 `config.json`（`%LOCALAPPDATA%\Vellum\config.json`），按服务商分别存放，
不会写入文献库，也不会随论文导出。

## 许可证

本项目基于 MIT 许可证，见 `LICENSE`。

后端与阅读界面移植自 [easyread](https://github.com/Edwardxlai/easyread)（MIT），
在其基础上改用 opencode CLI / 直连 API、并加了 Tauri + React 桌面外壳，出处见 `NOTICE`。

第三方组件许可见 `THIRD_PARTY_LICENSES.md`。
