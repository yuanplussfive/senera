# Pi 模块

Pi 负责会话树、流式文本、工具调用、多步循环、compaction 和标准 Skill 资源加载。生产执行内核是 `@earendil-works/pi-coding-agent` 的 `AgentSession`、`SessionManager` 与 `DefaultResourceLoader`；Senera 负责工具规划策略选择、BAML 规划、Skill 语义激活、提示模板选择、工具授权与执行、Artifact 和领域事件。Native 模式直接使用 Pi 的供应商 Tool Calling adapter，不构造 BAML 规划或语义风险审核请求。模型切换会创建完整的 `AgentSystemRuntime`，按 provider 无限缓存这些对象会让 Electron 主进程的内存随着模型选择持续增长；Pi 的高频 `message_update` 绕过异步订阅者的完成信号时，还会积累事件队列和完整 trace payload。

## 关键签名

- Senera 是 Pi session system prompt 的唯一 owner。`AgentPiCodingAgentSessionFactory` 通过受管的 `PiSessionBaseSystemPrompt.liquid` 创建 `DefaultResourceLoader.systemPrompt`，让 Pi 把它作为 `customPrompt` 使用；Pi 自带的身份、内置工具目录和 Pi 文档导航不会进入模型上下文。稳定 Skill 目录由 runtime extension 注入一次；每轮的活动 Skill 索引、受控项目上下文和选中的 prompt templates 则随 durable `senera.turn-context/v1` 进入当前普通 user message。
- `AgentSystemRuntimeCache.acquire(modelProviderId?)` 返回 `{ runtime, release() }`，不再暴露无生命周期的 `get()`。
- `AgentPiSessionMutationServiceOptions.acquireRuntime(modelProviderId?)` 只为已有 Pi 会话的 rewind、reset、fork、compact、status 与 export 获取运行时租约；创建空会话不会构建 Pi runtime。
- Pi JSONL 与 Coding Agent session 只在首个实际 turn 的 `leaseTurn()` 中惰性建立，`PiTurnLeaseTimeoutSeconds` 约束该租约阶段，而不是 `session.create`。
- `RunSettlementTimeoutSeconds` 约束 destructive branch transition 等待旧 run、审批、工具和 Coding Agent 进入空闲状态的时间；超时只拒绝新操作，不绕过分支隔离屏障。
- `AgentPiModelRuntimeOwner.get()` 合并并发初始化；失败的 Promise 会从 owner 中移除，后续租约可以重试，不会把一次启动故障永久缓存。
- `AgentPiBackgroundShutdownTracker` 跟踪 LRU 淘汰后的异步关闭，立即发出受限诊断，并只保留有界的最近失败；pool `close()` 会 drain 后统一报告。
- `AgentPiCodingAgentSessionPool` 只编排 lease、rewind、fork、reset 和管理操作；`AgentPiCodingAgentSessionFactory` 独占 resource loader、settings、模型 runtime、工具物化和 session 重配置，`AgentPiCodingAgentSessionLifecycle` 独占 operation drain、LRU 淘汰、后台关闭和幂等 close。公共类型集中在 pool contracts，旧 pool import 路径继续导出它们。
- 租约阶段 deadline 只结束当前 turn 的等待，不丢弃仍在收尾的底层 Pi 操作；deadline 会通过独立 signal 传入 lease path，并由 `session.lease.phase.*` 诊断记录 queue、open/create、runtime rebuild、configure 与 context refresh 的耗时。这样重试不会伪装成新的独立初始化，运维可以区分同会话排队、文件/资源初始化和 runtime 重建。
- Coding Agent 原生 `subscribe` 是同步通知 API，不等待 listener Promise；`AgentPiCodingAgentSession` 必须把完整 `AgentSessionEvent` 放入有序交付队列，并在 `prompt()` 收口前 drain。collector 通过明确 event type guard 选择 message/tool 事件，不把 session lifecycle 强转成 core event。
- Pi JSONL 是会话上下文的唯一来源。Senera 不会从产品对话、工具事件或缓存重新导入历史；每个新 turn 只由 Pi 追加当前用户消息及其原生执行事件。
- `AgentPiTurnExecutor` 把 `collector.collect(event)` 作为异步 session listener；不能在调用侧用 `void` 提前丢弃其完成状态。
- `AgentLoop.PiSessions.MaxCachedSessions` 约束空闲 Coding Agent session；active lease 只能在 release 后参与 LRU 淘汰。默认值由 `AgentDefaultCatalog` 提供。

## 工具规划 provider 边界

每个 pooled Coding Agent session 独享一个 `ModelRuntime`。`AgentPiModelRuntimeOwner` 只读取已解析的 `ToolPlanningMode`，并注册其中一个 provider：

- `native`：`AgentPiNativeToolProvider` 按声明的 Endpoint 选择 Pi 原生 API adapter，直接发送当前曝光工具的 JSON Schema。
- `baml`：`AgentPiBamlToolProvider` 调用 `AgentPiPlanningCompiler`，由 BAML 生成工具决策和参数。

两条路径都返回标准 Pi assistant stream，共享 session frame、工具批次注册、权限预检、执行桥、Artifact、Observation v3、历史和 compaction。运行中不会从 native 静默回退到 BAML；能力或协议不满足时在配置边界失败。BAML 路径中不存在 localhost HTTP、OpenAI-compatible DTO、SSE 响应伪装、私有 header 或模块级 turn registry。

两条路径共享规范化会话事实，但使用不同的 prompt/wire projection：

- Native 的 system prompt 只包含稳定行为、人设表达和执行环境。RootCommand、用户任务副本、文本工具目录、JSON/XML 工具调用说明和输出哨兵都不会进入 prompt；Pi API adapter 把 `Context.tools`、assistant `toolCall` 与 `toolResult` 映射到供应商原生协议。
- BAML 的 system prompt 只包含语义行为、人设表达和执行环境。`AgentPiPlanningCompiler` 把 RootCommand 放在 `seneraRuntime.rootCommand`，把历史放在 `planningContext.messages`，把曝光工具放在 `routingCards`；`EvolveTurn` 看不到完整参数 Schema，只有选定工具后的 `FillPiToolArguments` 收到该工具的权威合同。

## 提示缓存

主请求使用稳定 system prompt 和 append-only 会话历史。当前场景、已触发规则及其关联 signal、进行中的 Workflow、当前会话身份、活动 Skill 与模板组成当前用户消息前置的 `senera.turn-context/v1`：由 Pi 的公开 `session.prompt()` 一次写入普通 user message，和用户请求一起持久化到 Pi JSONL，不再依赖请求结束时清理的 overlay。稳定画像和 Skill 目录属于 system prefix；Skill 正文通过 `SeneraCommand skills read` 按需召回，历史 facts、events、digests、evidence 与风格示例由 Memory/Artifact 工具按需召回。缓存路由键按逻辑会话、模型、调用阶段、稳定 system prompt 与工具合同内容寻址，Native、BAML planning、compaction 和 ResidentSpeech 不共用路由桶。

Continuity 学习、对话片段边界、时间摘要、频道最终改写和 ResidentSpeech 等辅助调用也使用独立的身份域和静态合同 revision。当前 episode、摘要条目和工具结果只进入动态 user payload，不进入缓存身份。首个请求、模型切换、稳定人设或项目上下文变化、工具 Schema 集合变化仍会产生必要的冷写；缓存键不能用来掩盖协议变化。供应商 TTL 通过 Pi 的兼容层发送，不能根据模型名称在业务代码中猜测。所有 Native provider 请求（包括 `AgentRequiredNativeToolCall` 的短链路）同时通过 Pi adapter 的 `onPayload` 和可注入 `fetch` 记录最终 payload 摘要、真实 HTTP body 摘要（不记录密钥或正文）和稳定前缀字节数；`prompt_cache` 诊断只把供应商 usage 中的 `cacheRead`/`cacheWrite` 解释为 `hit`/`miss`，没有 usage 时保持 `requested`，适配器明确不支持时为 `unsupported`。因此同一个 logical cache scope 只代表请求亲和性，物理 `sessionId`、逻辑缓存域和供应商 scope 始终分开，绝不伪造缓存命中，也能验证请求体是否真的保持稳定。

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

`message_update` 只投影为 `model.delta`，不额外创建 Pi trace。其他 Pi trace 的字符串、数组、对象属性和递归深度必须受限，再发送到 WebSocket 或写入 run history。属性上限必须在读取属性值前生效，因为 `Object.entries(payload).slice(...)` 会先遍历并分配整个宽对象，不满足内存边界。

工具 observation 在执行桥中只编译一次：完整原始结果进入 Artifact，严格 Observation v3 进入 Pi JSONL。后续规划只验证协议并选择完整回合，不再维护 batch digest cache，也不根据 `result`、`content` 或任意 payload 字段重新猜测或二次裁剪。批次中的每个 call 都先获得显式 token reservation；执行成功、执行失败和 Pi 在执行前产生的校验/预检失败都会幂等结算。Pi 自身生成的纯文本失败在写入历史前编译为同一 v3 协议，不会留下占用预算但无法被规划器读取的终态。

## 会话复用

同一 runtime 内的 Coding Agent session 以会话 ID 为键复用，但只保留最近的空闲 session。淘汰时释放 hooks 并 abort 旧 session；下一次访问通过持久 JSONL 重建上下文，active session 始终保留到 lease release。

新建空 Senera 会话不构造 runtime，也不建立 Pi JSONL。首个实际 `session.message` 通过 `create_if_missing` 原子建立 Senera 会话，Pi 只在 `leaseTurn()` 中 `open_or_create`。同一会话后续回合优先复用 persistent `AgentSession`，避免每轮重新读取和解析整棵 session tree。

产品层 fork 以 turn preparation 中持久化的 Pi boundary entry 为锚点。Session 层按稳定顺序同时获取 source/target admission，在内存构造目标快照并先写 durable fork journal；Pi 再使用 `SessionManager.forkFrom()` 复制原生树并 `branch()` 到该边界，Artifact 服务随后为目标追加 request-scoped owner。只有这些步骤都完成后，SQLite 才在一个 transaction 中写入目标 Conversation/run/preparation/event snapshot 并删除 journal，然后发布 `session.created` 与 `session.forked`。任何中途失败都会 reset 目标 Pi、释放目标 Artifact owner 并撤销 journal；启动恢复也会回滚未提交 journal，因此目标在最终 commit 前不可见。

已初始化会话支持原生 compact、runtime status 和 JSONL/HTML export。缓存中的会话直接复用，未缓存会话用短生命周期的管理 session 打开，操作结束即释放。WebSocket 只返回稳定统计 DTO 和相对导出路径；Pi 的绝对 session 文件路径不会穿过 Senera 协议边界。导出文件统一写入 workspace layout 的 `.senera/exports/sessions`。

## 项目上下文

`.senera/context/PROJECT.md` 是进入 Pi system prompt 的唯一工作区项目上下文文件。`DefaultResourceLoader` 禁用通用 context-file 扫描，通过 `agentsFilesOverride` 只注入该文件，避免意外读取仓库中的其他约定文件。文件使用 regular-file snapshot 读取并按存在性与内容生成 SHA-256 fingerprint；每轮 lease 都检测变化，变化后等待会话空闲并调用完整 `session.reload()`，所以下一轮立即生效，不用重启服务或创建新对话。

项目上下文属于 runtime-owned host state，普通 workspace 写入工具不能修改；它应由部署、用户或专门的受控管理入口维护。文件不存在表示没有项目级补充指令，不触发兼容回退或目录猜测。

自动压缩的正式触发、压缩边界、摘要生成和 JSONL 提交都由 Pi `AgentSession` 负责；Senera 不决定正式 compaction，也不在工具循环里生成摘要、追加 compaction entry、在 native/compaction 请求前投影或拒绝输入。BAML 的普通规划只允许对自己的 planner payload 做协议级形状整理，不会改写 Pi JSONL；BAML compaction 请求则原样保留 Pi 提供的上下文。`AgentTurnTokenBudget` 只读取 Pi 已报告的 context usage，并在 usage 尚未覆盖的尾部使用本地估算，用于当前回合的 observation 分配；Pi 自己报告的 context usage 和原生 compaction 设置是正式触发依据。

`session_before_compact` 只刷新连续性状态并暂存由原生消息计算出的 Artifact/tool/continuity 索引；它返回 `undefined`，因此 Pi 继续执行自己的 summary。只有 `session_compact` 成功后，Senera 才把这些索引作为隐藏 custom entry 追加到同一 Pi 分支；`session_compact_failed` 会丢弃暂存索引。Senera 不维护候选摘要、预热摘要、确定性摘要恢复或第二套压缩阈值。

`AgentTurnTokenBudget` 只维护当前回合的动态输入窗口：优先使用 Pi 已报告的 context usage，未报告的尾部才使用本地估算；模型的 max-output 字段不参与窗口容量。并行 observation 先扣除已经计入 Pi usage 的 assistant 回合和固定 tool-result 外壳，再按实际剩余量分配。预算不足是 context-pressure 状态，压缩器返回带 Artifact/evidence 坐标的最小协议结果，让 Pi 继续完成回合并由原生阈值触发 compaction，不把成功的工具执行改写成预算异常，也不触发第二套历史消息压缩。

最终 assistant `message_end` 与 compaction settlement 是两个明确阶段。collector 在确认 stop reason 不是工具调用、错误或取消后立即发布稳定回答；该消息使用 Loop 预先分配的固定 ID，标记为 `terminal=false`。Pi 完成自动压缩、事件 drain 和 session settlement 后，Session 原子提交同一 ID 的 `terminal=true` 回答与 `RunCompleted`。因此用户可以先阅读答案，同时看到“正在压缩上下文”，下一轮仍必须等待当前 session lease 正式释放。

Pi Session JSONL 是 assistant message、tool call、tool result、分支和 compaction 的权威执行记录。Senera Conversation SQLite 只保存产品层用户消息和最终回答，不再复制 OpenAI transcript 或工具证据。工具结果的模型可见摘要保留在 Pi `toolResult`；完整 raw/projection/evidence/workspace 内容与 SHA-256 receipt 保留在 Artifact 服务。

原生 compaction 移除旧消息前，`session_before_compact` 只从明确的 Pi `toolResult` 和 Observation v3 evidence 提取 Artifact URI、call ID、tool name 和可读 ref。压缩完成后写入分支内的隐藏 `senera.artifact_index` custom entry。该 entry 不进入模型上下文；后续规划上下文只读取 Pi 原生保留消息，Artifact 索引由工具和 Memory 按需读取。索引绝不复制 raw result 或完整 workspace evidence，Schema 无效时发出诊断并拒绝部分数据。

## 工具并发边界

Pi 工具定义使用 `executionMode: "parallel"`，让同一批次的独立调用进入执行桥。安全串行化不由 Pi 的静态 per-tool 开关承担：Pi Core 只要在一个批次里看到任意 `sequential` 工具，就会把整个批次全部串行，无法表达“同资源冲突、不同资源并发”。

每回合的不可变 `toolAccessGrant` 包含明确授权的工具名，并可在 Registered 策略下包含 MCP 服务 ID 与包修订。同轮首次发现的真实工具按服务身份检查授权，不依赖发现前的工具名快照；显式名称上限不会扩大为服务授权。Native 保持 Bootstrap 加固定 ToolCall 的稳定 schema，ToolDescribe 确认可用工具契约后通过桥执行。BAML 的 ToolLoad 使用 Pi 公共扩展 API 注册本轮新发现的真实 schema，再更新 `AgentToolExposureState`；下一次规划收到新契约与 exposure generation，不用重建会话。不可用工具不能确认、加载或自动复用。请求级 `tool_choice` 只能收窄曝光集合；provider、permission hook、执行桥和最终执行器共享同一授权边界。

工具定义绑定 contract digest。MCP `tools/list_changed` 更新 registry 后，旧 Pi 回合尝试调用同名但契约已变化的工具时，会在执行器分派前失败；新目录只在后续回合以新的工具指纹和 Schema 进入 Coding Agent。

真实并发由 ToolRuntime 的执行调度器决定。普通调用默认并行，但每次运行受 `ToolExecution.MaxConcurrentCallsPerRun` 的有界容量控制；插件还可以通过 `Runtime.MaxConcurrency` 声明更低的工具级上限。`ResourceClaims` 工具根据声明的资源参数生成 shared/exclusive claim，重叠资源中任意一方为 exclusive 时等待，不重叠资源可以并发；`SelfManaged` 工具由所属运行时自行调度。MCP 工具未声明策略时不添加 server 级别的隐式租约，直接走普通并行；只有 MCP 工具显式声明 `ResourceClaims` 才按资源互斥。空资源声明不会再变成隐式全局独占租约，资源契约或投影无效会显式失败。权限检查、参数校验和实际工具执行仍是权威边界，模型的 `dependsOn` 不能绕过资源租约。

Native 与 BAML provider 都必须在 assistant 响应完成时登记完整的 call ID、工具名和参数批次。Pi Core 会逐项触发 `tool_call` hook，但 `AgentPiToolCallPreflightCoordinator` 在第一个 hook 上启动整批受控并行预检，后续 hook 只读取对应 Promise；同一 call 不会重复 OPA、语义审核或审批。确定性边界始终执行。只有 `toolPlanningMode=baml`、`SemanticAudit.Mode=approval_sensitive` 且审批模式为 `always_ask` 时，BAML 语义风险审核才可能把确定性 `allow` 提升为用户 `ask`；Native、`agent`、`full_access` 和 `disabled` 都不调用该审核器。`full_access` 只消除可审批的 `ask`，不能覆盖确定性 `deny`、Schema、grant、OPA、workspace 或 sandbox 拒绝。`tool.calls.planned` 一次发布全部 call 身份，执行器拿到调度租约后才发布 `tool.call.started`，因此前端可以区分待审核、等待资源和实际运行。

## Skill 提示词投影

Pi 会在稳定 system 层收到一个由 `AgentExtensionRegistry` 派生的
`senera.skill_library` 目录。目录只包含 Skill 名称、短说明、来源范围、
状态、按需加载标记、标签/用例和能力名称，不包含宿主绝对路径、逻辑 URI、revision 或正文；它使用现有
Prompt Wire 的 TOON/compact JSON 无损选择，因此相同注册表会产生稳定字节。
模型先用目录按名称选择候选，再通过 `SeneraCommand skills inspect`（名称）和
`skills read`（名称、包内相对路径）按需读取；目录变化由宿主内部 revision 触发资源重载，不把 revision 写入模型消息。

`DefaultResourceLoader` 是 Pi 会话内 Skill 发现、标准 frontmatter 校验、collision 诊断和资源重载的权威来源，加载 `.senera/skills`、`System/Skills`，以及扩展注册表已经验证的 Skill contribution 精确文件路径。它不会递归扫描任意扩展目录来猜测未声明的 Skill。Senera 不再维护平行的 Pi Skill 文件缓存；模型可见目录只是在现有注册表目录投影上增加稳定的逻辑入口，不是第二套 Skill registry。

活跃身份必须同时匹配 Pi catalog 的 `name` 与规范文件路径。同名 collision、文件缺失或目录指向不一致会给出确定性错误，不能静默改读另一个文件。Skill catalog revision 变化时，持久会话先等待空闲，再重载 ResourceLoader 并重建下一轮系统提示词；不重建对话，也不重复注册 runtime extension hooks。

选择分数、匹配词和匹配字段只用于运行时诊断与学习，不发送给执行模型。执行模型只收到 Skill 的注册名称、状态和按需加载标记；逻辑 URI、绝对路径和 revision 都由宿主内部维护。正文不会在每轮 prompt 中复制，也不会被转换成另一种标记语言。需要具体规范时，模型通过 `SeneraCommand skills read` 按名称和包内相对路径读取正文，读取结果由同一工具结果链路进入当前回合并保留原始 Artifact 坐标。

Skill 不再维护独立的正文披露 ledger，也不把“已读正文”写成隐藏 custom entry。Pi JSONL 只记录实际发生的普通 user message、assistant message、tool call、tool result、分支和原生 compaction；资源索引的 revision 负责判断是否需要重新读取，Pi 原生历史负责持久化、重放和压缩。资源变化、注册表 collision、路径缺失或 revision 不一致都会明确报告，不能静默切换到另一个来源。

Skill 的显式入口由实时注册表生成：`/skill-name` 是规范命令，旧的 `$skill-name` 继续兼容；解析器只接受命令边界，不会把 URL 或绝对路径当成 Skill。目录扫描按 source revision 复用已校验的 catalog，文件变化才重新解析 frontmatter。Skill 选择由任务文本、可用工具和现有 hybrid retrieval 证据共同驱动；本地 `ternlight-mini-cn` 只负责语义候选，最终激活仍经过注册表、权限和 revision 校验。

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
