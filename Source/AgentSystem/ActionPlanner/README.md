# ActionPlanner 模块导览

`ActionPlanner` 是共享的结构化模型调用边界，不是 AgentLoop 前置状态机。模型选择 `ToolPlanningMode=baml` 时，`AgentPiBamlToolProvider` 把当前 Pi context 和会话局部 turn state 交给 PlanningCompiler；它调用 `EvolveTurn`，在选定工具后调用 `FillPiToolArguments`，结构无效时进入对应 repair。`native` 模式的工具规划不会经过 ActionPlanner。Pi 负责自动压缩的触发、压缩边界和 JSONL 提交，但 `baml` 模式下的摘要文本仍由本边界生成。

## 真实调用关系

```text
Pi Coding Agent provider call
  -> AgentPiBamlToolProvider
  -> AgentPiPlanningCompiler
     ├─ 工具规划分支
     │  -> AgentPiPlanningContextCompiler（同一次 compile() 内构造并调用）
     │  -> AgentActionPlannerModelClient
     └─ compaction 分支（Pi 以 cacheRetention=none 请求摘要）
        -> AgentActionPlannerModelClient.compactPiContext
  -> AgentActionPlannerCoreModelCalls
  -> AgentActionPlannerStructuredCaller
  -> AgentActionPlannerBamlPromptFactory
  -> BAML request builder
  -> AgentActionPlannerPromptProjector
  -> AgentActionPlannerModelTransport
     -> Pi declared API adapter
     -> configured model provider
```

`AgentPiPlanningModelAdapter`（位于 `Runtime/`）提供 `AgentActionPlannerModelClient`，`AgentPiPlanningCompiler` 同时持有该 client 与 `AgentPiPlanningContextCompiler`。

当前核心 BAML 函数是 `EvolveTurn`、`RepairControllerDecision`、`FillPiToolArguments`、`RepairPiToolArguments` 和工具风险审计（`AuditToolRisk`、`RepairToolRiskAudit`），声明在 `baml_src/action_planner.baml`。Pi compaction 的触发、边界与 JSONL 提交由 Pi 原生 session 负责，但 `baml` 模式下的摘要文本经 `compactPiContext` 调用 `baml_src/auxiliary.baml` 的 `SummarizePiContext`；上下文由 `projectPiCompactionMessage` 投影为文本消息，`toolResult` 缺少配对的 summary prompt 时明确失败，不静默丢弃。`native` 模式的压缩不经过本边界。

## 规划边界

- Planner routing cards 只包含当前 `AgentToolExposureState` 的曝光快照；工具完整 JSON Schema 只在工具已选定后加载。
- RootCommand 只存在于 `seneraRuntime.rootCommand`，不会同时复制到 `planningContext.systemPrompt`。
- `preferredToolNames` 只影响稳定排序，不能裁剪其他 exposed 工具。`tool_choice` 只能进一步收窄，不能扩大 grant。
- ToolSearch 可以在同一回合追加已授权工具；后续 native provider 调用读取新的 exposure generation。
- 参数草稿必须经过权威 JSON Schema/AJV 校验。模型返回的工具名、参数或依赖关系不能绕过 registry、grant、contract digest、OPA、审批或资源租约。
- BAML parse 与 repair 集中在 structured caller；调用方不得自行解析 Markdown、临时 JSON 片段或 XML 字符串。

相关回归测试位于 `Scripts/BackendTests/ActionPlanner`。
