# senera

senera 是一个可观测的 Agent 运行时和 Web 工作台。它让模型保持自然对话体验，同时在需要工具时切换到可校验、可重试、可追踪的工具调用协议。

核心目标很简单：让 AI 不只是聊天，而是能稳定地搜索、读取项目、执行插件、修改文件，并把每一步都清楚展示出来。

## 为什么用 senera

- **工具调用更可靠**：只有需要工具时才输出 `<tool_calls>`；参数会走 schema 校验、错误诊断和自动 repair。
- **过程完全可见**：前端右侧展示模型流式输出、决策、工具调用、结果、失败原因和重试链路。
- **插件独立可扩展**：每个工具插件自己带 manifest、签名、配置和运行入口；宿主只负责发现、校验、调度和隔离。
- **多模型统一接入**：支持 OpenAI Responses、Chat Completions、Claude Messages、Google GenerateContent 以及兼容接口。
- **本地工作区友好**：内置工作区地图、快速搜索、索引搜索、文件读取、补丁修改、Shell 执行等能力。

## 快速开始

要求：Node.js 20+

```bash
npm install
cd Frontend
npm install
cd ..
```

创建本地运行配置：

```bash
copy senera.config.example.json senera.config.json
```

编辑 `senera.config.json`，填写模型服务的 `BaseUrl`、`ApiKey` 和 `Model`。

启动后端：

```bash
npm run server
```

启动前端：

```bash
cd Frontend
npm run dev
```

默认地址：

- 前端：`http://127.0.0.1:5173`
- 后端 WebSocket：`ws://127.0.0.1:8787`

CLI 也可以直接使用：

```bash
npm run cli
```

## 配置模型

最小配置看 [senera.config.example.json](./senera.config.example.json)。常用字段：

- `DefaultModelProviderId`：默认模型。
- `ModelProviders`：模型供应商列表，前端会自动读取并显示。
- `Endpoint`：上游协议类型，支持 `Responses`、`ChatCompletions`、`ClaudeMessages`、`GoogleGenerateContent`。
- `MaxOutputTokens`：填 `-1` 表示不传该 API 字段，让上游模型自由输出。
- `AgentLoop.MaxSteps`：填 `-1` 表示不限制最大行动步数。
- `LoadedTools`：填 `"all"` 加载全部工具，也可以填工具名数组做白名单。

真实配置文件 `senera.config.json` 已在 `.gitignore` 中忽略，不要把密钥提交到仓库。

## 工具与插件

senera 的工具是插件化的。插件通过 `PluginManifest.json` 声明工具名称、签名、说明、权限和运行入口；工具参数通过 `ToolSignature.ts` 与 schema 校验；插件可以用 Node.js、Python 或其它进程实现。

当前内置/示例能力包括：

- `AskUserTool`：缺少必要信息时向用户提问。
- `TavilySearchTool`：联网搜索，支持多 key 轮询。
- `FastContextWorkspaceMapTool`：快速了解工作区结构。
- `FastContextSearchTool`：基于 ripgrep 的快速文本/符号搜索。
- `FastContextIndexSearchTool`：本地轻量索引搜索。
- `FastContextReadTool`：按文件读取上下文。
- `ApplyPatchTool`：以受控补丁方式修改文件。
- `ShellCommandTool`：在配置的安全工作区内执行命令。
- `WeatherTool`、`TaskPrioritizerTool` 等示例插件。

插件私有配置使用 `PluginConfig.toml`，例如 Tavily API key。真实 `PluginConfig.toml` 已被忽略；需要公开模板时使用 `PluginConfig.example.toml`。

## 协议设计

senera 把模型输出分成两种模式：

- **普通回复**：直接输出自然语言或 Markdown。
- **工具调用**：整条回复只能是一个完整的 `<tool_calls>` XML 根标签。

这样可以避免普通聊天被 XML 包络污染，同时保留工具调用所需的结构化校验、自动修复和审计能力。

## 常用命令

```bash
npm run check
npm run build
npm run server
npm run cli
```

前端：

```bash
cd Frontend
npm run check
npm run build
npm run dev
```

## 安全说明

- `senera.config.json`、`.env`、`.senera/`、插件 `PluginConfig.toml`、构建产物和依赖目录默认不提交。
- 工具进程有超时和 stdout/stderr 大小限制。
- 插件 manifest 会声明权限，宿主按声明执行发现、校验和调度。
- 公开仓库前请确认没有把真实 API key 写入 README、example 或提交历史。
