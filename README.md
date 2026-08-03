# senera

> 一个可观测、可校验、可扩展的 Agent 工作台。
> 让模型像正常聊天一样表达，也能在需要行动时稳定地搜索、读写文件、调用工具、留下证据。

<p>
  <img alt="Node" src="https://img.shields.io/badge/Node.js-22%2B-43853d">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6">
  <img alt="Protocols" src="https://img.shields.io/badge/LLM-OpenAI%20%7C%20Claude%20%7C%20Gemini-8a2be2">
  <img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue">
</p>

写 senera 的起点是一个很具体的烦恼：常见的 Agent 应用，要么是聊天壳，模型说得好听、动手全凭运气；要么把工具调用押在供应商的原生 tools 实现上，换一家模型服务，行为就跟着变。参数里多一个没转义的引号，整条链路断在半路，用户只能对着加载圈干等，事后连模型到底做过什么都查不到。

所以 senera 把两件事放进同一个产品里认真做：让模型正常说话，也让它的每一次行动都过校验、可审批、留证据。模型只需要稳定输出文本，统一的 PiProxy 决策层和 Pi 多步工具循环会把文本约束成结构化动作——上游是 OpenAI、Claude、Gemini 还是任何 OpenAI-compatible 服务，走的都是同一条链路，不依赖供应商是否实现原生 tools。

---

## 它是怎么做的

senera 把状态按职责拆开：产品 Conversation 保存用户消息和最终回答；Pi Session JSONL 保存 assistant、tool call、tool result、分支和压缩记录；Artifact 保存原始输出、投影、证据、工作区变更和完整性 receipt；Memory 保存指向这些来源的学习索引。所有上游模型都经过 PiProxy + BAML 投影成可校验动作，供应商差异被挡在投影层外面。

工具调用不靠模型"猜对格式"。每个注册工具都有输入、输出和执行合同，模型生成的动作先过结构校验，参数再由 AJV 或 Zod 对真实 schema 校验。结构错了，会带着具体字段路径进入修复流程，而不是把坏 JSON 直接交给工具执行。执行过程对用户也不是黑箱：前端把预回复、工具计划、审批、开始执行、结果摘要、失败原因和最终回复分开展示，看到的是"边说边做"的过程，而不是等很久之后只拿到一个最终答案。

工具多了会把上下文塞爆，这件事没有银弹，senera 的取舍是动态检索：结合本地索引、BM25/RRF/MMR 和 SQLite 记忆反馈，只把当前任务真正可能用到的工具放进上下文。工具结果则生成 artifact/evidence 包，长期上下文优先使用摘要和证据投影，需要时再取回原始内容——旧日志、旧搜索结果不会一直躺在上下文里，追查时也能回到模型当时真正依据的东西。

工具边界由注册合同确定：执行目标、网络能力、工作区权限、资源语义和 artifact 策略。System Tool 可以使用受信任的宿主能力，MCP package 可以放进 microsandbox microVM 边界。Sandbox 不可用或被部署禁用时，运行时会明确拒绝该执行目标，绝不会悄悄改在本机执行。

---

## 具体怎么写

### Agent 动作协议

senera 把每一轮任务拆成清晰的动作：

- `FinalAnswer`：信息足够，直接回复用户。
- `AskUser`：缺少必要输入，向用户追问。
- `CallTools`：需要行动，先给出一段自然语言预回复，再规划工具调用。

`CallTools` 不要求模型一次性写出所有复杂参数。运行时会先让模型选择需要的工具和依赖关系，再并发生成各个工具的参数。工具调用 ID 由宿主生成，例如 `call_xxx`，依赖关系在宿主侧投影和校验，避免把稳定性押在模型自己编 ID 上。

### PiProxy + Pi 工具循环

PiProxy 负责把不同供应商的文本生成能力统一约束成结构化动作，Pi 负责会话、流式文本、工具调用和多步循环。供应商原生 tools 不参与运行时分支，所有模型遵循同一条链路：

1. Pi 从当前 Session 分支读取规范消息上下文。
2. PrepareInteraction 在一次结构化调用中完成追问理解，并生成首个 FinalAnswer、AskUser 或 CallTools 动作。
3. PiProxy 一次性消费这个已验证首动作，不重复调用动作选择模型。
4. 如果需要工具，按真实 JSON Schema 校验参数并执行工具。
5. 把模型可见 observation 写成 Pi tool result；完整结果发布为 Artifact，只有后续动作才调用 SelectPiAction，直至最终回答。

这让工具能力与供应商 API 解耦。底层不是把所有提示词写死成一大段，而是把工具协议、上下文策略、证据投影和工具描述分层生成。

### 分层保存上下文

Pi Session JSONL 保存标准消息结构和工具生命周期，Conversation SQLite 保存用户原话与最终回复。即使某些上游接口不接受 `role: "tool"`，协议差异也只在 PiProxy 请求边界投影，不会污染产品对话数据。

大结果不会在多个存储层复制：Pi tool result 持有模型所需 observation 和 `details.senera` 引用；Artifact 持有完整内容与校验 receipt；Memory 持有 URI 索引。Pi 原生 compaction 会删除旧消息，但在当前分支留下隐藏 Artifact 索引；每次请求只在真实剩余 token 预算内注入最近且尚未可见的 URI，旧引用可通过 Memory 定位后再读取。

### 上下文策略

senera 不把历史工具原文无限塞回模型。新一轮任务会优先使用：

- 当前轮的完整用户输入和新工具结果。
- 历史轮次的最终回复和必要工具摘要。
- artifact / evidence 的结构化摘要、事实、URI。
- 动态召回的项目记忆和相关文件片段。

早期大段输出会沉淀成证据投影，真正需要原文时再通过 artifact 工具取回。这样上下文不会被旧日志、旧搜索结果、旧文件内容拖爆。

### 扩展写法

Senera 内部控制面使用 `System/Extensions/<id>/extension.json` 包；独立业务能力保持标准 MCP package。第一方包位于 `McpServers/<package>/`，工作区包位于 `.senera/mcp/<package>/`，可使用 MCPB `manifest.json`、Registry `server.json` 或兼容 `.mcp.json`。MCP Server 通过 `tools/list` 声明工具 schema；Senera 只适配连接、类型化输入、沙箱、热重载和诊断，不要求纯 MCP 包增加私有 manifest。

Agent 只创建标准 Skill，目录位于 `.senera/skills/<name>/`。Skill 可通过 `metadata.senera.recommended-tools` 绑定已经注册的 System/MCP 工具；绑定只提升动态加载优先级，不授予权限。`SkillManage` 负责创建、更新、校验和移除，并在发布前验证工具引用；复杂 Toolkit Skill 的资源树由一次 `WorkspaceApplyPatch` 原子创建，并在写入前预检完整候选目录。成功修改会在同一会话下一条消息热加载，无需重启或新建对话。

---

## 能做什么

- 搜索资料、查询天气、读取图片和文档。
- 理解项目结构，搜索代码，读取和修改工作区文件。
- 执行受控 shell 命令，并把 stdout/stderr、退出码和工作目录整理成证据。
- 在需要高风险操作时先请求用户审批。
- 把工具结果、文件 diff、摘要、证据 URI 和最终回答串成完整链路。
- 用 System Tool、Skill 或 MCP 扩展能力，不用修改 Agent 主循环。

---

## 快速开始

本地运行要求 Node.js 22+。真实密钥放在 `senera.config.json`，这个文件已被 git 忽略。

### Nano 轻量开发分支

只需要本机源码开发时，可以直接克隆自动生成的 `nano` 分支：

```bash
git clone --depth 1 --branch nano --single-branch https://github.com/yuanplussfive/senera.git senera
cd senera
npm ci
npm run dev
```

`nano` 只保留开发服务器、前端、核心源码、MCP packages、Skills 和对应依赖，不包含 Docker、Electron、安装包、测试、覆盖率和发布工具。它在 `main` 完整验证通过后自动重建，不接收直接提交或 Pull Request。分支内置经过 SHA-256 校验的版本化 Sandbox Bundle，首次准备沙箱不再访问 GitHub Releases 或容器镜像仓库。

### Docker

在首次启动前，直接编辑 `compose.yaml` 中已经写明的管理员资料和访问 Origin：

```yaml
SENERA_ADMIN_LOGIN_NAME: "admin"
SENERA_ADMIN_DISPLAY_NAME: "Your Name"
SENERA_ADMIN_PASSWORD: "replace-with-a-strong-password"
SENERA_ALLOWED_ORIGINS: "http://localhost:8787,http://127.0.0.1:8787,http://192.168.1.20:8787"
SENERA_ALLOW_INSECURE_HTTP: "true"
```

Docker 部署不要求向 Senera 主容器传入 `/dev/kvm` 或 `NET_ADMIN`。Compose 会先从现有公开 `senera` GHCR package 拉取并探测独立的 `sandbox-runtime-*` 镜像标签，再启动仅通过 Unix Socket 接收受限请求的 `sandbox-worker`；只有该 Worker 能访问 Docker Engine API，主服务仍以非 root `node` 身份运行。Worker 在启动时读取 Docker Engine 能力：已注册 `runsc` 时锁定 gVisor，否则锁定受限 Docker Engine 容器；一次服务生命周期内不会再次切换。然后启动唯一的 Compose 部署：

```bash
# 生产环境应使用 GHCR 页面或发布信息中显示的完整 digest。
export SENERA_IMAGE=ghcr.io/yuanplussfive/senera@sha256:<application-digest>
export SENERA_SANDBOX_IMAGE=ghcr.io/yuanplussfive/senera@sha256:<sandbox-digest>
docker compose pull
docker compose up -d --pull always
```

不要使用 `docker run` 单独启动应用镜像。镜像需要 Compose 同时准备 `sandbox-runtime`、`sandbox-worker`、私有控制 Socket 和数据卷；缺少其中任何一项都会在启动阶段明确失败。

容器会在每次启动时同步 Compose 声明的管理员资料：未变化时不重写，用户名、显示名或密码变化时更新账户；磁盘只保存 `scrypt` 密码哈希。服务通过 `8787:8787` 发布，随后可打开 `http://localhost:8787` 或已加入 Origin 白名单的 IP 地址。运行数据默认保存在 Docker volume 里。部署、日志、非 root 容器权限和沙箱说明见 [部署与运维](docs/Operations.md)，版本变化见 [更新记录](CHANGELOG.md)。

Docker 不把 Microsandbox OCI Bundle 塞进应用镜像，也不调用 Docker `/images/load`。`docker compose pull` 使用标准 Registry 协议分别获取应用镜像和版本化沙箱运行时，支持分层缓存、断点续传和平台校验；Worker 只使用 Compose 已准备好的镜像，缺失时明确失败，不会下载、导入或猜测镜像身份。正式发布的应用与沙箱镜像都附带 SBOM，发布验证和生产部署使用 `name@sha256:...` 引用。gVisor 与受限 Docker Engine provider 共用只读根文件系统、非 root 用户、能力全移除、`no-new-privileges`、资源限制和统一网络策略。默认允许正常联网，只有工具显式声明 `Network: Deny` 时才断网。完整前提见 [部署与运维](docs/Operations.md#docker-启动)。

### 本地开发

```bash
npm ci
copy senera.config.example.json senera.config.json
npm run sandbox.archive
npm run dev
```

macOS / Linux 创建配置文件：

```bash
cp senera.config.example.json senera.config.json
```

然后编辑 `senera.config.json`，填好模型服务的 `BaseUrl`、`ApiKey` 和 `Model`。首次读取后，`ApiKey` 和敏感请求头会以 AES-256-GCM 密文写回 JSON/SQLite；未设置 `SENERA_CONFIG_SECRET_KEY` 时，本地密钥保存在工作区 `.senera/data/config/config-secrets.key`。不要提交或丢失这个文件，生产环境建议改用独立注入的环境密钥。运行期间通过设置界面提交的配置由配置服务直接生效，并同步写回 JSON 镜像，不会触发开发服务器重启；直接编辑磁盘配置后需要显式重启开发服务。`sandbox.archive` 是开发环境显式的 Bundle 准备步骤，会在 `Release/SandboxImage` 生成与正式包相同的压缩资产；服务启动本身只读取本地文件，不会自动下载或回退。启动后打开 `http://127.0.0.1:5173`。

仓库使用 npm workspaces，只需要在根目录执行一次 `npm ci`。依赖版本由根目录 `package-lock.json` 锁定；只有主动增删依赖时才使用 `npm install <package>`，并同时提交 `package.json` 和 `package-lock.json`。

---

## 模型与协议

一个模型提供方通常由两部分组成：

- `ModelProviderEndpoints[]`：端点、BaseUrl、ApiKey。
- `ModelProviders[]`：具体模型、协议类型、输出上限和前端展示信息。

供应商重命名会同步迁移遵循 `providerId/model` 约定的模型 ID、默认模型、分组和运行时客户端引用；旧模型 ID 会保留为兼容别名，以便历史会话继续解析。

支持的上游协议：

- OpenAI Responses
- OpenAI Chat Completions
- Anthropic Claude Messages
- Google GenerateContent
- OpenAI-compatible Chat Completions 服务

供应商原生 tools 不是运行时前提。senera 使用统一的结构化投影、校验、修复、执行和回填链路，使不支持原生工具调用的模型也能进入相同的 Pi 工具循环。

---

## 工具、Skills 与 MCP

运行时能力分为三层：

- System Tool：Senera 常驻的可信宿主控制面，由 `System/Extensions/<id>` 包将工具合同映射到预注册 capability。
- Skill：标准 `SKILL.md` 工作流，可自动触发，并可通过 namespaced metadata 推荐已注册工具；工作区 Skill 位于 `.senera/skills/<name>/`，官方 Skill 位于 `System/Skills/<name>/`。
- MCP package：可移植 MCP Server 包；第一方包位于 `McpServers/<package>/`，工作区包位于 `.senera/mcp/<package>/`，支持 MCPB、Registry 和兼容 `.mcp.json`。

系统基础能力包括：

- `ToolSearchTool`：动态工具发现。
- `ArtifactReadTool`：读取可追溯 artifact 资源，JSON 使用预计算结构 sidecar、独立 index/query cursor 和可续传 typed query；`MemoryRecallTool`、`MemoryWriteTool`：长期记忆。
- `AskUserTool`：缺少必要信息时向用户提问。
- `ShellCommandTool`、`ShellStartTool` 和 Execution Resource 工具：受控命令与后台终端。
- `ShellCommandTool`：受控读取、搜索、测试、构建和诊断；`WorkspaceApplyPatch`：原子修改工作区。
- `WorkspaceApplyPatch`：原子应用结构化文件 patch，并对 `.senera/skills` 候选执行提交前预检。
- `System/Skills`：代码执行、工作区调查、前端检查、文档/图片理解、联网研究、天气和 Skill 创建工作流。
- `SkillManage`：创建、更新、校验和移除工作区 Skill；每轮常驻，不参与 ToolSearch 检索加载。
- `LearningManage`：查看 Tool/Skill 路由学习状态、最近 episode、失败或跳过原因，以及绑定 Skill revision 的触发词；只读且每轮常驻。

以下官方业务能力由 `McpServers` 提供：

- `web-research/search`：联网搜索。
- `weather/forecast`：天气查询。

以下可信宿主能力由 System Tool 提供：

- `DocumentExtract`：文档解析。
- `ImageAnalyze`：图像理解。

天气与 Tavily 的 MCPB `user_config` 将 API key 明确声明为 Secret，并将 API host、语言和单位声明为普通配置。运行时仅授权宿主支持的执行后端交集；权限、网络、进程生命周期和热重载始终由宿主决定。

---

## 证据与记忆

senera 会把工具调用结果整理成 artifact pack，包括输入、原始结果、摘要、证据、投影和变更信息。模型上下文默认不直接塞大段 raw output，而是优先使用结构化摘要和证据 URI——上下文更短，不容易被历史工具结果拖爆；需要追查时可以回到原始 artifact；长期记忆也能基于新鲜证据沉淀，而不是反复学习旧历史。

学习分成三个边界：`MemoryLearning` 提取跨会话耐久事实，Tool 路由学习改进工具检索，Skill 路由学习从可归因的成功执行中积累触发词。三者不共享一个大模型输出。Tool/Skill 路由会先写 observable episode，再标记 learned、skipped 或 failed；Skill 经验绑定发布 revision，内容更新后旧经验自动失效。可直接让 Agent“查看学习状态”调用 `LearningManage` 诊断。

---

## 目前的局限

有些事还没做好，写在这里，省得部署完才发现：

- 认证是单管理员账户模型，没有多用户和权限分级。适合个人和小团队自部署，不适合直接当多租户服务开给别人用。
- 桌面端目前只打包 Windows 安装包；macOS 和 Linux 请用 Web 或 Docker 方式运行。
- 界面文案是中英双语，但后端错误消息目前只有中文目录，英文界面偶尔会看到中文报错。
- 自动化测试覆盖 Chromium 和 Electron，暂时没有 Firefox / WebKit 的跨浏览器回归。

---

## 项目结构

```text
senera/
├─ Apps/                    Server 和 Desktop 入口
├─ Build/                   构建与沙箱运行时准备
├─ Source/AgentSystem/      Agent 运行时核心
├─ System/Extensions/       常驻 System extension 包与 Tool 合同
├─ System/Skills/           官方标准 Skills
├─ McpServers/              自动发现的 MCP packages
├─ .senera/skills/          工作区标准 Skills
├─ .senera/mcp/             工作区标准 MCP packages
├─ .senera/context/PROJECT.md  注入 Pi system prompt 的受控项目上下文（每轮检测并热重载）
├─ .senera/data/            按 config、sessions、memory、tool-search 分流的运行时数据
├─ Packages/                内部运行时包
├─ baml_src/                BAML 定义
├─ Scripts/                 维护脚本
├─ Frontend/                React + Vite 工作台
└─ senera.config.example.json
```

更多开发细节可以看：

- [核心链路导览](docs/Architecture/CoreFlow.md)
- [WebSocket 协议参考](docs/API/WebSocketProtocol.md)
- [开发手册](docs/Development/README.md)
- [Skills 与外部工具](docs/Development/ManagedExtensions.md)
- [术语表](docs/Glossary.md)

---

## License

本项目基于 [Apache License 2.0](./LICENSE) 开源。
