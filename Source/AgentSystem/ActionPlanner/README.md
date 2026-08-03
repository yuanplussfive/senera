# ActionPlanner 模块导览

`ActionPlanner` 是共享的结构化模型调用边界，不是 AgentLoop 前置状态机。生产主链中，PiProxy 根据当前 OpenAI-compatible transcript 和显式 turn context 调用 `EvolveTurn`，在选定工具后调用 `FillPiToolArguments`；结构无效时进入对应 repair。安全审计、工具观察摘要、Memory 和 Tool 学习复用同一套 transport 与 structured-output runner。

## 真实调用关系

```text
Pi Coding Agent HTTP request
  -> AgentPiProxyHttpApi
  -> AgentPiAssistantCompiler
  -> AgentPiOpenAiPlanningProjector
  -> AgentActionPlannerModelClient
     -> AgentActionPlannerCoreModelCalls
     -> AgentActionPlannerStructuredCaller
     -> AgentActionPlannerBamlPromptFactory
     -> BAML request builder
     -> AgentActionPlannerPromptProjector
     -> AgentActionPlannerModelTransport
```

当前核心 BAML 函数是 `EvolveTurn`、`RepairControllerDecision`、`FillPiToolArguments`、`RepairPiToolArguments`、工具风险审计和工具观察摘要。Loop 的 turn preparation 只做确定性的 Skill/Tool/RootCommand 准备，不调用规划模型。

## 阅读顺序

1. `AgentActionPlannerModelClient.ts`：公开的强类型模型调用门面，拆分 core 与 learning 两类能力。
2. `AgentActionPlannerCoreModelCalls.ts`：BAML 函数、parse 函数和定向 repair 的显式映射。
3. `AgentActionPlannerStructuredCaller.ts`：统一 structured output、诊断、repair budget 和取消传播。
4. `AgentActionPlannerBamlPromptFactory.ts`：调用生成的 BAML request builder，再按函数选择 planner 或 plain prompt projection。
5. `AgentActionPlannerPromptProjector.ts`：验证 BAML envelope/timeline，并投影为模型 system prompt 与消息数组。
6. `AgentPlannerContextProjectorRegistry.ts`：按明确 context key 和 order 注册投影器。
7. `AgentPlannerTimelineBlockRegistry.ts`：按 timeline `kind` 精确查找投影器，并验证每类 payload。
8. `AgentPromptXml.ts`：唯一的 planner prompt XML 结构化序列化边界。
9. `AgentActionPlannerModelTransport.ts` / `AgentActionPlannerProviderResolver.ts`：模型 endpoint、超时、usage 和 timing。

## JSON 到 XML 投影

上下文数组的 JSON 到 XML 不是按字段猜测，也不是在一组解析器里取 first match。投影遵循四个确定性步骤：

1. `AgentActionPlannerPromptProjector` 使用 Zod 验证最外层 envelope 和 timeline turn。非法结构直接失败，不带病进入模型。
2. context 使用 `AgentPlannerContextProjectorRegistry` 按唯一 `key` 精确读取，并按 `order + key` 稳定排序。未知字段统一进入 lossless `extra_context`，不会被静默丢弃。
3. timeline 使用 `AgentPlannerTimelineProjectorRegistry` 按明确 `kind` 做 O(1) 查找。每个 projector 拥有自己的 Zod payload schema；重复 kind 在注册阶段报错。未知 kind 使用保留 `content + payload + refs` 的通用投影，不探测 `payload.calls`、`payload.observations` 等字段来猜类型。
4. `AgentPromptXml` 构造受限 AST，并交给 `fast-xml-parser` 的 `XMLBuilder`。动态值只能以 text、canonical JSON text 或 attribute 进入，统一处理 XML 字符、名称校验和转义；业务代码不拼接标签字符串。

这使 `kind` 成为权威判别字段，payload schema 成为局部合同，XML builder 成为唯一转义边界。JSON 对象仍以稳定 canonical JSON 文本嵌入 XML，既保留嵌套数据的完整语义，也避免为每个业务字段手写标签。

## 扩展投影

新增 context 区块时使用 `defineAgentPlannerContextProjector({ key, order, schema, project })`；新增 timeline 类型时使用 `defineAgentPlannerTimelineProjector({ kinds, payloadSchema, project })`。扩展必须满足：

- key/kind 唯一，冲突在 registry 构造时失败；
- payload 先由 Zod 校验，再进入 projector；
- 顺序由声明式 `order` 或原 timeline 顺序决定，不依赖对象枚举偶然顺序；
- 未消费的数据要显式保留为 payload/metadata，不能静默截断；
- 动态 XML 只能通过 `promptXmlText`、`promptXmlJson`、`promptXmlChildren` 和 `promptXmlNode` 构造；
- 同步增加 registry、escaping、unknown fallback 和 round-trip 行为测试。

## 规划边界

- Planner routing cards 只包含当前 `AgentToolExposureState` 的曝光快照；工具完整 JSON Schema 只在工具已选定后加载。
- `preferredToolNames` 只影响稳定排序，不能裁剪其他 exposed 工具。`tool_choice` 只能进一步收窄，不能扩大 grant。
- ToolSearch 可以在同一回合追加已授权工具；后续 PiProxy 请求读取新的 exposure generation。
- 参数草稿必须经过权威 JSON Schema/AJV 校验。模型返回的工具名、参数或依赖关系不能绕过 registry、grant、contract digest、OPA、审批或资源租约。
- BAML parse 与 repair 集中在 structured caller；调用方不得自行解析 Markdown、临时 JSON 片段或 XML 字符串。
- 学习调用是可观测旁路，不得改变主任务的成功或失败结果。

相关回归测试位于 `Scripts/BackendTests/ActionPlanner`，至少覆盖 envelope 校验、context registry、timeline registry、unknown fallback、XML 转义、BAML transport 和结构化 repair。
