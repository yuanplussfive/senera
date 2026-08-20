# Pi 模块

Pi 负责会话树、流式文本、工具调用、多步循环、compaction 和标准 Skill 资源加载。生产执行内核是 `@earendil-works/pi-coding-agent` 的 `AgentSession`、`SessionManager` 与 `DefaultResourceLoader`；Senera 负责工具规划策略选择、BAML 规划、Skill 语义激活、提示模板选择、工具授权与执行、Artifact 和领域事件。Native 模式直接使用 Pi 的供应商 Tool Calling adapter，不构造 BAML 规划或语义风险审核请求。模型切换会创建完整的 `AgentSystemRuntime`，按 provider 无限缓存这些对象会让 Electron 主进程的内存随着模型选择持续增长；Pi 的高频 `message_update` 若绕过异步订阅者的完成信号，还会积累事件队列和完整 trace payload。

## 关键签名

- `AgentSystemRuntimeCache.acquire(modelProviderId?)` 返回 `{ runtime, release() }`，不再暴露无生命周期的 `get()`。
- `AgentPiSessionMutationServiceOptions.acquireRuntime(modelProviderId?)` 仅为已有 Pi 会话的 rewind、reset、fork、compact、status 与 export 获取运行时租约；创建空会话不会构建 Pi runtime。
- Pi JSONL 与 Coding Agent session 只在首个实际 turn 的 `leaseTurn()` 中惰性建立，`PiTurnLeaseTimeoutSeconds` 约束该租约阶段，而不是 `session.create`。
- `RunSettlementTimeoutSeconds` 约束 destructive branch transition 等待旧 run、审批、工具和 Coding Agent 进入空闲状态的时间；超时只拒绝新操作，不绕过分支隔离屏障。
- `AgentPiModelRuntimeOwner.get()` 合并并发初始化；失败的 Promise 会从 owner 中移除，后续租约可以重试，不会把一次启动故障永久缓存。
- `AgentPiBackgroundShutdownTracker` 跟踪 LRU 淘汰后的异步关闭，立即发出受限诊断，并只保留有界的最近失败；pool `close()` 会 drain 后统一报告。
- `AgentPiCodingAgentSessionPool` 只编排 lease、rewind、fork、reset 和管理操作；`AgentPiCodingAgentSessionFactory` 独占 resource loader、settings、模型 runtime、工具物化和 session 重配置，`AgentPiCodingAgentSessionLifecycle` 独占 operation drain、LRU 淘汰、后台关闭和幂等 close。公共类型集中在 pool contracts，旧 pool import 路径继续导出它们。
- Coding Agent 原生 `subscribe` 是同步通知 API，不等待 listener Promise；`AgentPiCodingAgentSession` 必须把完整 `AgentSessionEvent` 放入有序交付队列，并在 `prompt()` 收口前 drain。collector 通过明确 event type guard 选择 message/tool 事件，不把 session lifecycle 强转成 core event。
- Pi 会在新 JSONL 中先写入 model、thinking 等运行时元数据；历史迁移与 `setHistory()` 的空会话判断必须使用 `buildSessionContext().messages`，不能使用 leaf 是否存在，否则首轮同步会把元数据误判成对话历史。
- `AgentPiTurnExecutor` 把 `collector.collect(event)` 作为异步 session listener；不能在调用侧用 `void` 提前丢弃其完成状态。
- `AgentLoop.PiSessions.MaxCachedSessions` 约束空闲 Coding Agent session；active lease 只能在 release 后参与 LRU 淘汰。默认值由 `AgentDefaultCatalog` 提供。

## 工具规划 provider 边界

每个 pooled Coding Agent session 独享一个 `ModelRuntime`。`AgentPiModelRuntimeOwner` 只读取已解析的 `ToolPlanningMode`，并注册其中一个 provider：

- `native`：`AgentPiNativeToolProvider` 按声明的 Endpoint 选择 Pi 原生 API adapter，直接发送当前曝光工具的 JSON Schema。
- `baml`：`AgentPiBamlToolProvider` 调用 `AgentPiPlanningCompiler`，由 BAML 生成工具决策和参数。

两条路径都返回标准 Pi assistant stream，共享 session frame、工具批次注册、权限预检、执行桥、Artifact、Observation v3、历史和 compaction。运行中不会从 native 静默回退到 BAML；能力或协议不满足时在配置边界失败。BAML 路径中不存在 localhost HTTP、OpenAI-compatible DTO、SSE 响应伪装、私有 header 或模块级 turn registry。

两条路径共享规范化会话事实，但使用不同的 prompt/wire projection：

- Native 的 system prompt 只包含稳定行为、预设和执行环境。RootCommand、用户任务副本、文本工具目录、JSON/XML 工具调用说明和输出哨兵都不会进入 prompt；Pi API adapter 把 `Context.tools`、assistant `toolCall` 与 `toolResult` 映射到供应商原生协议。
- BAML 的 system prompt 只包含语义行为、预设和执行环境。`AgentPiPlanningCompiler` 将 RootCommand 放在 `seneraRuntime.rootCommand`，将历史放在 `planningContext.messages`，将曝光工具放在 `routingCards`；`EvolveTurn` 看不到完整参数 Schema，只有选定工具后的 `FillPiToolArguments` 收到该工具的权威合同。

Provider-neutral 的 Native 请求形状如下，具体 HTTP 字段由 Pi 的 OpenAI Responses、Chat Completions、Anthropic 或 Google adapter 负责：

```ts
{
  systemPrompt: "<agent_system>...native behavior and environment...</agent_system>",
  messages: [
    { role: "user", content: "检查项目" },
    { role: "assistant", content: [{ type: "toolCall", id: "call_1", name: "WorkspaceRead", arguments: { path: "package.json" } }] },
    { role: "toolResult", toolCallId: "call_1", toolName: "WorkspaceRead", content: [{ type: "text", text: "{...Observation v3...}" }] }
  ],
  tools: [
    { name: "WorkspaceRead", description: "...", parameters: { type: "object", properties: { path: { type: "string" } } } }
  ]
}
```

BAML 的第一阶段请求不发送供应商原生 `tools`，而是发送显式 planning DTO：

```ts
{
  planningContext: { systemPrompt, messages, toolTranscript, projection },
  routingCards: [{ name: "WorkspaceRead", summary: "...", inputs: ["arguments.path: string"] }],
  seneraRuntime: { rootCommand, toolAccessGrant, toolExposure, activeSkills, planState }
}
```

模型选择 `WorkspaceRead` 后，第二阶段才增加 `tool: { name, description, parameters }` 来物化参数。代码不得把这两个形状重新合并成一套“通用工具提示词”。

`AgentPiMutableSessionFrame` 是 provider 与当前租约之间唯一的会话局部绑定；`AgentPiTurnState` 持有 grant、tool exposure、active skill 投影、usage ledger、tool plan 和 token budget。turn 开始时设置，结束时在 `finally` 中清除。持久 session 同一时间只允许一个 turn lease，因此不需要跨请求查找上下文，也不得重新增加全局 `Map`、空 grant 回退或按 payload 猜测状态。

`AgentPiPlanningContextCompiler` 只读取 Pi 的明确消息角色和严格 Observation v3。它按完整用户回合选择最近历史，并从同一消息集合生成 tool transcript；当前回合不能完整放入输入容量时明确失败。Active Skill 在进入 planning contract 前经过白名单投影，文件路径、匹配分数、匹配词和 revision 只属于 Senera 运行时诊断，不发送给模型。

## 租约规则

```ts
const lease = runtimeCache.acquire(modelProviderId);
try {
  return await loop.run(request);
} finally {
  lease.release();
}
```

默认缓存只保留一个最近使用的空闲 runtime。创建另一个 provider 的 runtime 前，必须关闭所有空闲 entry；有 active lease 的 entry 不得被关闭。配置版本变化时，旧的 active generation 可以短暂与新 generation 共存，直到旧租约释放。

## 流事件与内存边界

`message_update` 只投影为 `model.delta`，不额外创建 Pi trace。其他 Pi trace 的字符串、数组、对象属性和递归深度必须受限，再发送到 WebSocket 或写入 run history。属性上限必须在读取属性值前生效——`Object.entries(payload).slice(...)` 会先遍历并分配整个宽对象，不满足内存边界。

工具 observation 在执行桥中只编译一次：完整原始结果进入 Artifact，严格 Observation v3 进入 Pi JSONL。后续规划只验证协议并选择完整回合，不再维护 batch digest cache，也不根据 `result`、`content` 或任意 payload 字段重新猜测或二次裁剪。批次中的每个 call 都先获得显式 token reservation；执行成功、执行失败和 Pi 在执行前产生的校验/预检失败都会幂等结算。Pi 自身生成的纯文本失败在写入历史前编译为同一 v3 协议，不会留下占用预算但无法被规划器读取的终态。

## 会话复用

同一 runtime 内的 Coding Agent session 以会话 ID 为键复用，但仅保留最近的空闲 session。淘汰时释放 hooks 并 abort 旧 session；下一次访问通过持久 JSONL 重建上下文，active session 始终保留到 lease release。

新建空 Senera 会话不构造 runtime，也不建立 Pi JSONL。首个实际 `session.message` 通过 `create_if_missing` 原子建立 Senera 会话，Pi 只在 `leaseTurn()` 中 `open_or_create`。同一会话后续回合优先复用 persistent `AgentSession`，避免每轮重新读取和解析整棵 session tree。

产品层 fork 以 turn preparation 中持久化的 Pi boundary entry 为锚点。Session 层按稳定顺序同时获取 source/target admission，在内存构造目标快照并先写 durable fork journal；Pi 再使用 `SessionManager.forkFrom()` 复制原生树并 `branch()` 到该边界，Artifact 服务随后为目标追加 request-scoped owner。只有这些步骤都完成后，SQLite 才在一个 transaction 中写入目标 Conversation/run/preparation/event snapshot 并删除 journal，然后发布 `session.created` 与 `session.forked`。任何中途失败都会 reset 目标 Pi、释放目标 Artifact owner 并撤销 journal；启动恢复也会回滚未提交 journal，因此目标在最终 commit 前不可见。

已初始化会话支持原生 compact、runtime status 和 JSONL/HTML export。缓存中的会话直接复用，未缓存会话用短生命周期的管理 session 打开，操作结束即释放。WebSocket 只返回稳定统计 DTO 和相对导出路径；Pi 的绝对 session 文件路径不会穿过 Senera 协议边界。导出文件统一写入 workspace layout 的 `.senera/exports/sessions`。

## 项目上下文

`.senera/context/PROJECT.md` 是进入 Pi system prompt 的唯一工作区项目上下文文件。`DefaultResourceLoader` 禁用通用 context-file 扫描，通过 `agentsFilesOverride` 只注入该文件，避免意外读取仓库中的其他约定文件。文件使用 regular-file snapshot 读取并按存在性与内容生成 SHA-256 fingerprint；每轮 lease 都检测变化，变化后等待会话空闲并调用完整 `session.reload()`，因此下一轮立即生效，无需重启服务或创建新对话。

项目上下文属于 runtime-owned host state，普通 workspace 写入工具不能修改；它应由部署、用户或专门的受控管理入口维护。文件不存在表示没有项目级补充指令，不触发兼容回退或目录猜测。

自动压缩完全由 Coding Agent 根据所选 provider 返回的 context usage 与原生 compaction 设置触发。Native 路径记录供应商上报 usage；BAML 路径汇总 planning compiler usage。两者都写入 Senera ledger。Senera 只通过 Pi compaction hook 提供结构化摘要文本和 Artifact 索引，不维护第二套会话压缩状态机。当前 turn collector 在同一有序事件队列中处理真实 `compaction_start` / `compaction_end`，并通过 `AgentPiCompactionActivityObserver` 发出 `compacting_context` 开始与终态事件。

工具循环中的上下文压力由 `AgentPiMidRunCompactionCoordinator` 在 Pi 的公开 `prepareNextTurnWithContext` 边界检查。它只在完整工具批次结束后，用“上一供应商输入占用 + 本轮 assistant/toolResult 增量”判断压力，不重复 BPE 估算整棵历史；真正请求前 Native 与 BAML 仍分别校验各自最终 provider payload。工具批次建立 reservation 时先扣除完整 assistant 消息和空 tool-result 外壳，剩余容量才分配给 observation，因预算截断的 observation 继续携带 Artifact URI。压缩摘要及其 Artifact/tool-call 检索索引会先作为同一候选快照完成 provider 投影和容量验证，验证通过后才追加到会话，避免预演使用旧索引而低估最终输入。

触发阈值由模型输入容量、输出保留量和 Pi 的 `keepRecentTokens` 推导，不增加散落的百分比常量。协调器优先使用 Pi 的 turn-safe cut；若最新的已完成 tool result 自身跨过 `keepRecentTokens`，则以明确的 call ID 配对验证完整尾部批次，并把 assistant tool-call 与全部对应结果作为不可拆分后缀保留。摘要写入 append-only SessionManager 之前会先投影并测量候选 provider 输入，只有确认能够容纳才持久化 compaction entry 与 Artifact/Tool-call 索引、重建活动消息并重基 `AgentTurnTokenBudget`。因此单次 `prompt()` 内可以继续执行，同时不会留下一个已写入但仍超容量的压缩状态。

Mid-run 压缩复用 `AgentPiCompactionController` 的摘要和索引逻辑，不另建会话状态机。摘要期间通过嵌套的 `compacting_context` activity 和 `compaction.mid_turn.*` 诊断事件反馈到前端；失败只在当前投影仍可安全发送时继续，否则以明确的上下文容量错误结束，不能靠重复重试掩盖无可压缩历史。

最终 assistant `message_end` 与 compaction settlement 是两个明确阶段。collector 在确认 stop reason 不是工具调用、错误或取消后立即发布稳定回答；该消息使用 Loop 预先分配的固定 ID，标记为 `terminal=false`。Pi 完成自动压缩、事件 drain 和 session settlement 后，Session 原子提交同一 ID 的 `terminal=true` 回答与 `RunCompleted`。因此用户可以先阅读答案，同时看到“正在压缩上下文”，下一轮仍必须等待当前 session lease 正式释放。

Pi Session JSONL 是 assistant message、tool call、tool result、分支和 compaction 的权威执行记录。Senera Conversation SQLite 只保存产品层用户消息和最终回答，不再复制 OpenAI transcript 或工具证据。工具结果的模型可见摘要保留在 Pi `toolResult`；完整 raw/projection/evidence/workspace 内容与 SHA-256 receipt 保留在 Artifact 服务。

原生 compaction 移除旧消息前，`session_before_compact` 只从明确的 Pi `toolResult` 和 Observation v3 evidence 提取 Artifact URI、call ID、tool name 和可读 ref。压缩完成后写入分支内的隐藏 `senera.artifact_index` custom entry。该 entry 不进入模型上下文；后续 `context` hook 按模型窗口、输出保留量和当前 Pi 消息占用，从最近的 archived Artifact 开始装入剩余空间。已经在活动 tool result 中可见的 Artifact 不重复投影，装不下的旧引用只计入 `omittedArtifacts`，可通过 Memory 重新定位。索引绝不复制 raw result 或完整 workspace evidence，Schema 无效时发出诊断并拒绝部分数据。

## 工具并发边界

Pi 工具定义使用 `executionMode: "parallel"`，让同一批次的独立调用进入执行桥。安全串行化不由 Pi 的静态 per-tool 开关承担：Pi Core 只要在一个批次里看到任意 `sequential` 工具，就会把整个批次全部串行，无法表达“同资源冲突、不同资源并发”。

Coding Agent 每回合持有 `toolAccessGrant.authorizedToolNames` 的宿主工具定义。BAML compiler 与 native provider 都只投影 `AgentToolExposureState.exposedToolNames`，并把多个 `preferredToolNames` 稳定排在前面。ToolSearch 可在同一回合追加已授权工具；下一次 provider 调用读取新的 exposure generation，无需重建会话。请求级 `tool_choice` 可以进一步收窄曝光集合，但不能扩大 grant。provider、permission hook、执行桥和最终执行器共享同一授权与曝光状态，任一边界缺失 grant 都会关闭工具执行。

工具定义绑定 contract digest。MCP `tools/list_changed` 更新 registry 后，旧 Pi 回合若尝试调用同名但契约已变化的工具，会在执行器分派前失败；新目录只在后续回合以新的工具指纹和 Schema 进入 Coding Agent。

真实并发由 ToolRuntime 的执行调度器决定。普通调用默认并行，但每次运行受 `ToolExecution.MaxConcurrentCallsPerRun` 的有界容量控制；插件还可以通过 `Runtime.MaxConcurrency` 声明更低的工具级上限。`ResourceClaims` 工具根据声明的资源参数生成 shared/exclusive claim，重叠资源中任意一方为 exclusive 时等待，不重叠资源可以并发；`SelfManaged` 工具由所属运行时自行调度。空资源声明不会再变成隐式全局独占租约，资源契约或投影无效会显式失败。权限检查、参数校验和实际工具执行仍是权威边界，模型的 `dependsOn` 不能绕过资源租约。

Native 与 BAML provider 都必须在 assistant 响应完成时登记完整的 call ID、工具名和参数批次。Pi Core 会逐项触发 `tool_call` hook，但 `AgentPiToolCallPreflightCoordinator` 在第一个 hook 上启动整批受控并行预检，后续 hook 只读取对应 Promise；同一 call 不会重复 OPA、语义审核或审批。确定性边界始终执行。只有 `toolPlanningMode=baml`、`SemanticAudit.Mode=approval_sensitive` 且审批模式为 `always_ask` 时，BAML 语义风险审核才可能把确定性 `allow` 提升为用户 `ask`；Native、`agent`、`full_access` 和 `disabled` 都不调用该审核器。`full_access` 只消除可审批的 `ask`，不能覆盖确定性 `deny`、Schema、grant、OPA、workspace 或 sandbox 拒绝。`tool.calls.planned` 一次发布全部 call 身份，执行器拿到调度租约后才发布 `tool.call.started`，因此前端可以区分待审核、等待资源和实际运行。

## Skill 提示词投影

`DefaultResourceLoader` 是 Pi 会话内 Skill 发现、标准 frontmatter 校验、collision 诊断和资源重载的权威来源，加载 `.senera/skills`、`System/Skills`，以及扩展注册表已经验证的 Skill contribution 精确文件路径。它不会递归扫描任意扩展目录来猜测未声明的 Skill。Senera 不再维护平行的 Pi Skill 文件缓存或自造 Skill catalog；它只根据显式调用、语义匹配与学习证据产生活跃 Skill 身份。

活跃身份必须同时匹配 Pi catalog 的 `name` 与规范文件路径。同名 collision、文件缺失或目录指向不一致会给出确定性错误，不能静默改读另一个文件。Skill catalog revision 变化时，持久会话先等待空闲，再重载 ResourceLoader 并重建下一轮系统提示词；不重建对话，也不重复注册 runtime extension hooks。

选择分数、匹配词和匹配字段只用于运行时诊断与学习，不发送给执行模型。经 Pi catalog 确认的文件读取 frontmatter 之后的完整 Markdown 正文，并通过 `pi-agent-core` 的标准 Skill invocation envelope 注入一次；不会再经过 Markdown 到 XML 的节点转换，也不会重复生成 Skill catalog。作者可以在正文末尾写自定义 EOF 注释帮助模型辨认长文档边界，也可以保持纯 Markdown，宿主不解析或自动补写该注释。

Pi 用户 extension、内置文件工具和 package tool 不启用。只有受信任的 `senera-runtime` extension factory 常驻；System Tool 与 MCP 仍通过 `customTools` 进入 Pi，并继续经过 Senera 的 grant、OPA、sandbox、Artifact 和结果契约边界。

## 行为矩阵

| 条件                                    | 行为                                                   |
| --------------------------------------- | ------------------------------------------------------ |
| 同 provider、同配置 fingerprint         | 复用 runtime 并增加 lease                              |
| 切换 provider，旧 runtime 空闲          | 先关闭旧 runtime，再构造新 runtime                     |
| 切换 provider，旧 runtime active        | 保留旧 runtime，直到 release                           |
| Pi turn lease 超时但租约 Promise 未结束 | 迟到的 session 自动 dispose，不泄漏 session lease      |
| `message_update`                        | 保留 `model.delta`；不发送或持久化完整 Pi trace        |
| executor 的 slow `model.delta` sink     | prompt 等待 collector 完成，不能绕过为 fire-and-forget |
| trace payload 有数百个属性              | 只读取摘要和 sanitation 上限内的属性                   |
| idle Coding Agent session 超过上限      | 淘汰 LRU idle session，不 abort active session         |

几个具体场景：Flash run 已结束后切到 Pro，Flash runtime 必须在 Pro runtime 构造前关闭；同一 provider 的连续请求复用最近的 idle runtime；释放第二个 idle session 不影响仍 active 的第一个，第一个 release 后才按 LRU 淘汰旧 session。在 `loop.run()` 外释放租约（可能关闭活跃 session）和绕过 `AgentPiCodingAgentSession` 直接向原生同步 subscriber 挂异步工作（失去收口背压）都是这条契约要防的事故。

```ts
// Wrong: keeps a full runtime forever and bypasses Senera's event-delivery queue.
const runtime = runtimeCache.get(modelProviderId);
nativeCodingAgentSession.subscribe((event) => {
  void collector.collect(event);
});

// Correct: the caller owns a lease and subscribes through the Senera session adapter.
const lease = runtimeCache.acquire(modelProviderId);
session.subscribe((event) => collector.collect(event));
```

## 测试要求

- `AgentSystemRuntimeCache.test.ts` 覆盖同 provider 复用、空闲先关闭、active lease 保护、配置 generation 和 idempotent release。
- `PiStreamingStability.test.ts` 覆盖 async listener、`model.delta` 顺序、executor 的慢 sink 背压、`message_update` 不产生 Pi trace、宽对象读取上限和 trace payload 截断。
- `PiTurnExecutorBehavior.test.ts` 覆盖稳定回答先于 compaction settlement 可见、压缩活动成对结束以及 session lease 最终释放。
- `TurnPromptProjectionBehavior.test.ts` 覆盖 Native/BAML 模板选择，并禁止 RootCommand、用户任务副本、文本工具目录和旧输出哨兵进入两类 system prompt。
- `PiCodingAgentSubstrateBehavior.test.ts` 覆盖真实 `AgentPiSubstrate`、本地模型代理、HostCapability、artifact、工具结果回灌，以及扩展包 Skill 在同一持久会话中的加载和热重载。
- `PiSessionManagementBehavior.test.ts` 覆盖原生 fork、compaction 参数、稳定 stats DTO 和受控 JSONL/HTML 导出路径。
- `Session/PiSessionManagementBehavior.test.ts` 与 `SessionForkBehavior.test.ts` 覆盖管理事件、不可用状态和 SQLite/Pi 双存储原子回滚。
- `ToolResourceSchedulerBehavior.test.ts` 覆盖读读并发、读写串行、不同资源并发、公平等待和取消释放。
