# senera

> 一个可观测、可校验、可扩展的 Agent 工作台。
> 让模型像正常聊天一样表达,也能在需要行动时稳定地搜索、读写文件、调用插件、留下证据。

<p>
  <img alt="Node" src="https://img.shields.io/badge/Node.js-22%2B-43853d">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6">
  <img alt="Protocols" src="https://img.shields.io/badge/LLM-OpenAI%20%7C%20Claude%20%7C%20Gemini-8a2be2">
  <img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue">
</p>

<p align="center">
  <img alt="senera 工作台" src="docs/screenshot.png" width="100%">
</p>
<p align="center"><sub>三栏工作台:会话、自然对话、实时展开的思考和工具执行过程。</sub></p>

senera 不是一个简单的聊天壳。它更像一个透明的 AI 工作台:模型可以边说边做,工具执行过程可以被看到、被审批、被复盘,每次搜索、文件修改、命令执行都会留下结构化结果和证据。

它的核心目标是把“模型会聊天”和“模型能可靠行动”放在同一个产品里。模型只需要稳定输出文本，就能通过统一的 PiProxy 决策层和 Pi 多步工具循环获得一致的行动能力，不依赖供应商是否实现原生 tools。

---

## 核心卖点

- **统一的 tools 体验，不被供应商锁死。**
  senera 内部用 OpenAI 风格 transcript 保存用户消息、assistant 文本、tool calls 和 tool result。所有上游模型都经过 PiProxy + BAML 投影成可校验的动作，统一兼容 OpenAI、Claude、Gemini 和 OpenAI-compatible 模型服务。

- **工具调用不是靠模型“猜对格式”。**
  每个工具都有 manifest、签名和 JSON Schema 参数合同。模型生成的首动作和后续动作都经过结构校验；参数由 AJV 对真实工具 schema 校验，结构错了会带着具体字段路径进入修复流程，而不是把坏 JSON 直接交给工具执行。

- **过程可见,不是黑箱。**
  前端会把预回复、工具计划、审批、开始执行、结果摘要、失败原因和最终回复分开展示。用户看到的是“边说边做”的过程,不是等很久以后只拿到一个最终答案。

- **工具多了也不把上下文塞爆。**
  senera 会动态检索工具,结合本地索引、BM25/RRF/MMR 和 SQLite 记忆反馈,只把当前任务真正可能用到的工具放进上下文。

- **每次行动都有证据。**
  工具结果会生成 artifact/evidence 包,长期上下文优先使用摘要和证据投影,需要时再取回原始内容。这样能减少上下文膨胀,也方便追查模型到底依据了什么。

- **插件边界清楚。**
  工具通过插件扩展。插件声明自己的执行边界、网络能力、工作区权限和 artifact 策略;系统工具可以使用宿主能力,外部进程插件可以放进 microsandbox microVM 边界。

---

## 具体怎么写

### Agent 动作协议

senera 把每一轮任务拆成清晰的动作:

- `FinalAnswer`: 信息足够,直接回复用户。
- `AskUser`: 缺少必要输入,向用户追问。
- `CallTools`: 需要行动,先给出一段自然语言预回复,再规划工具调用。

`CallTools` 不要求模型一次性写出所有复杂参数。运行时会先让模型选择需要的工具和依赖关系,再并发生成各个工具的参数。工具调用 ID 由宿主生成,例如 `call_xxx`,依赖关系在宿主侧投影和校验,避免把稳定性押在模型自己编 ID 上。

### PiProxy + Pi 工具循环

PiProxy 负责把不同供应商的文本生成能力统一约束成结构化动作，Pi 负责会话、流式文本、工具调用和多步循环。供应商原生 tools 不参与运行时分支，所有模型遵循同一条链路：

1. 读取当前 OpenAI 风格 transcript。
2. PrepareInteraction 在一次结构化调用中完成追问理解，并生成首个 FinalAnswer、AskUser 或 CallTools 动作。
3. PiProxy 一次性消费这个已验证首动作，不重复调用动作选择模型。
4. 如果需要工具，按真实 JSON Schema 校验参数并执行工具。
5. 把工具结果写回 transcript；只有后续动作才调用 SelectPiAction，直至最终回答。

这让工具能力与供应商 API 解耦。底层不是把所有提示词写死成一大段，而是把工具协议、上下文策略、证据投影和插件描述分层生成。

### 像 OpenAI tools 一样保存上下文

数据库里保存的是标准化消息结构:用户原话、assistant 文本、tool calls、tool result、最终回复。即使某些上游接口不接受 `role: "tool"`,也只在请求模型前做投影,不会把存储层降级成一堆私有 XML 字符串。

这种写法有两个价值:

- 历史链路稳定,后续切换模型或协议不用迁移会话格式。
- 工具调用、工具结果和最终回复天然对齐,前端可以把“准备做什么”“正在做什么”“做完得到什么”分开展示。

### 上下文策略

senera 不把历史工具原文无限塞回模型。新一轮任务会优先使用:

- 当前轮的完整用户输入和新工具结果。
- 历史轮次的最终回复和必要工具摘要。
- artifact / evidence 的结构化摘要、事实、URI。
- 动态召回的项目记忆和相关文件片段。

早期大段输出会沉淀成证据投影;真正需要原文时再通过 artifact 工具取回。这样上下文不会被旧日志、旧搜索结果、旧文件内容拖爆。

### 插件写法

一个工具插件通常包含:

- `PluginManifest.json`: 插件身份、能力声明、执行边界。
- `ToolSignature.ts`: 工具名、参数 schema、返回结构、权限说明。
- `docs/*.md`: 给模型看的工具使用说明。
- `PluginConfig.toml`: 私有密钥和业务配置。

插件可以声明 `Execution.Boundary`、`Network`、`Workspace` 和 `LocalFallback`。系统工具可以使用本机能力;外部插件默认更适合放到沙箱边界里执行。Agent 主循环只认识统一的工具协议,不需要为每个业务插件写特殊分支。

---

## 能做什么

- 搜索资料、查询天气、读取图片和文档。
- 理解项目结构,搜索代码,读取和修改工作区文件。
- 执行受控 shell 命令,并把 stdout/stderr、退出码和工作目录整理成证据。
- 在需要高风险操作时先请求用户审批。
- 把工具结果、文件 diff、摘要、证据 URI 和最终回答串成完整链路。
- 用插件接入新的业务工具,不用改 Agent 主循环。

---

## 快速开始

要求:Node.js 22+。真实密钥放在 `senera.config.json`,这个文件已被 git 忽略。

### Docker

```bash
docker compose run --rm -it senera node Dist/Apps/AdminAccess.js init
docker compose up -d
```

第一条命令会在 Docker volume 中初始化管理员账户；已有账户时跳过。Senera 不提供默认账号或默认密码。启动后打开 `http://localhost:8787`。运行数据默认保存在 Docker volume 里。部署、日志、非 root 容器权限和沙箱说明见 [部署与运维](docs/Operations.md)，版本变化见 [更新记录](CHANGELOG.md)。

### 本地开发

```bash
npm ci
copy senera.config.example.json senera.config.json
npm run dev
```

macOS / Linux 创建配置文件:

```bash
cp senera.config.example.json senera.config.json
```

然后编辑 `senera.config.json`,填好模型服务的 `BaseUrl`、`ApiKey` 和 `Model`。启动后打开 `http://127.0.0.1:5173`。

仓库使用 npm workspaces,只需要在根目录执行一次 `npm ci`。依赖版本由根目录 `package-lock.json` 锁定;只有主动增删依赖时才使用 `npm install <package>`,并同时提交 `package.json` 和 `package-lock.json`。

---

## 模型与协议

一个模型提供方通常由两部分组成:

- `ModelProviderEndpoints[]`: 端点、BaseUrl、ApiKey。
- `ModelProviders[]`: 具体模型、协议类型、输出上限和前端展示信息。

支持的上游协议:

- OpenAI Responses
- OpenAI Chat Completions
- Anthropic Claude Messages
- Google GenerateContent
- OpenAI-compatible Chat Completions 服务

如果模型支持原生工具调用,senera 可以吃到 Pi 的工具循环能力;如果模型不支持,senera 会把工具语义投影成结构化动作,再由本地运行时负责校验、修复、执行和回填。

---

## 工具与插件

系统插件提供运行时基础能力:

- `AgentToolSearchPlugin`: 动态工具发现。
- `AgentCapabilitySkillsPlugin`: 代码调查、前端检查、文档理解、记忆形成等能力技能。
- `AgentArtifactMemoryPlugin`: 按 artifact / evidence URI 读取历史证据。
- `AgentMemoryRecallPlugin` / `AgentMemoryWritePlugin`: 长期记忆召回与写入。
- `AskUserToolPlugin`: 缺少必要信息时向用户提问。
- `AgentShellToolPlugin`: 在受控工作区内执行命令。
- `WorkspaceMcpToolsPlugin`: 读取、列目录、搜索、写文件等工作区能力。
- `WorkspacePatchToolPlugin`: 用结构化 patch 修改文件。
- `AgentTemplatePlugin`: Liquid 提示模板。

示例插件展示如何接业务工具:

- `TavilySearchToolPlugin`: 联网搜索。
- `WeatherToolPlugin`: 天气查询。
- `AgentDocumentPlugin`: 文档解析。
- `AgentImageVisionPlugin`: 图像理解。

插件私有配置放在 `PluginConfig.toml`,例如 Tavily API key。公开模板可以用 `PluginConfig.example.toml`。

---

## 证据与记忆

senera 会把工具调用结果整理成 artifact pack,包括输入、原始结果、摘要、证据、投影和变更信息。模型上下文默认不直接塞大段 raw output,而是优先使用结构化摘要和证据 URI。

这样有三个好处:

- 上下文更短,不容易被历史工具结果拖爆。
- 需要追查时可以回到原始 artifact。
- 长期记忆可以基于 fresh evidence 沉淀,而不是反复学习旧历史。

---

## 项目结构

```text
senera/
├─ Apps/                    Server 和 Desktop 入口
├─ Build/                   构建与沙箱运行时准备
├─ Source/AgentSystem/      Agent 运行时核心
├─ System/Plugins/          系统插件
├─ Plugins/                 示例和业务插件
├─ Packages/                内部 SDK 包
├─ baml_src/                BAML 定义
├─ Scripts/                 维护脚本
├─ Frontend/                React + Vite 工作台
└─ senera.config.example.json
```

更多开发细节可以看:

- [核心链路导览](docs/Architecture/CoreFlow.md)
- [WebSocket 协议参考](docs/API/WebSocketProtocol.md)
- [开发手册](docs/Development/README.md)
- [术语表](docs/Glossary.md)

---

## License

本项目基于 [Apache License 2.0](./LICENSE) 开源。
