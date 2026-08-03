# Pi 模块

Pi 负责会话、流式文本、工具调用、多步循环和标准 Skill 资源加载。生产执行内核是 `@earendil-works/pi-coding-agent` 的 `AgentSession`、`SessionManager` 与 `DefaultResourceLoader`；Senera 负责模型代理、Skill 语义激活、提示模板选择、工具授权与执行、artifact 和领域事件。模型切换会创建完整的 `AgentSystemRuntime`，按 provider 无限缓存这些对象会让 Electron 主进程的内存随着模型选择持续增长；Pi 的高频 `message_update` 若绕过异步订阅者的完成信号，还会积累事件队列和完整 trace payload。

## 关键签名

- `AgentSystemRuntimeCache.acquire(modelProviderId?)` 返回 `{ runtime, release() }`，不再暴露无生命周期的 `get()`。
- `AgentPiSessionMutationServiceOptions.acquireRuntime(modelProviderId?)` 仅为已有 Pi 会话的 rewind、reset、fork、compact、status 与 export 获取运行时租约；创建空会话不会构建 Pi runtime。
- Pi JSONL 与 Coding Agent session 只在首个实际 turn 的 `leaseTurn()` 中惰性建立，`PiTurnLeaseTimeoutSeconds` 约束该租约阶段，而不是 `session.create`。
- `RunSettlementTimeoutSeconds` 约束 destructive branch transition 等待旧 run、审批、工具和 Coding Agent 进入空闲状态的时间；超时只拒绝新操作，不绕过分支隔离屏障。
- `AgentPiModelRuntimeOwner.get()` 合并并发初始化；失败的 Promise 会从 owner 中移除，后续租约可以重试，不会把一次启动故障永久缓存。
- `AgentPiBackgroundShutdownTracker` 跟踪 LRU 淘汰后的异步关闭，立即发出受限诊断，并只保留有界的最近失败；pool `close()` 会 drain 后统一报告。
- `AgentPiCodingAgentSessionPool` 只编排 lease、rewind、fork、reset 和管理操作；`AgentPiCodingAgentSessionFactory` 独占 resource loader、settings、模型 runtime、工具物化和 session 重配置，`AgentPiCodingAgentSessionLifecycle` 独占 operation drain、LRU 淘汰、后台关闭和幂等 close。公共类型集中在 pool contracts，旧 pool import 路径继续导出它们。
- Coding Agent 原生 `subscribe` 是同步通知 API，不等待 listener Promise；`AgentPiCodingAgentSession` 必须把异步 listener 放入有序交付队列，并在 `prompt()` 收口前 drain。
- Pi 会在新 JSONL 中先写入 model、thinking 等运行时元数据；历史迁移与 `setHistory()` 的空会话判断必须使用 `buildSessionContext().messages`，不能使用 leaf 是否存在，否则首轮同步会把元数据误判成对话历史。
- `AgentPiTurnExecutor` 把 `collector.collect(event)` 作为异步 session listener；不能在调用侧用 `void` 提前丢弃其完成状态。
- `AgentLoop.PiSessions.MaxCachedSessions` 约束空闲 Coding Agent session；active lease 只能在 release 后参与 LRU 淘汰。默认值由 `AgentDefaultCatalog` 提供。

## PiProxy 边界

Pi 不导入 PiProxy。Pi 只依赖 `PiShared` 中的 OpenAI transport 协议、turn context store 和规划 DTO；HTTP adapter 由 WebSocket server 在 composition root 中创建。`ServerRuntime` 必须把同一个 `AgentPiTurnContextRegistry` 同时传给 runtime cache 与 server，否则 Pi 发出的 context ID 对代理不可见，请求会被 `invalid_pi_context` 拒绝。

每个 turn 通过 `piTurnContextId` 显式关联 grant、tool exposure、active skill 投影、usage ledger、tool plan 和 token budget。owner lease 覆盖整个 turn，代理请求另持 reader lease。turn 结束后不接受新 reader，已有 HTTP 请求释放后再删除状态。不得增加模块级 context `Map`、默认 registry、空 grant 回退或按 payload 猜测上下文。

Active Skill 在进入共享 planning contract 前经过白名单投影。文件路径、匹配分数、匹配词和 revision 只属于 Senera 运行时诊断，不发送给模型。共享 DTO 增加字段时必须同步更新投影测试和 PiProxy 文档。

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

工具 observation 的 grounded digest 只是一轮 Pi context 的派生视图，不是 JSONL 权威记录。每个 Coding Agent extension session 的 digest outcome cache 使用有界 LRU；已提交 observation view 在对应 observation 离开当前 context 后立即释放。不得把完整 observation、失败 digest 或 context projection 按整个长期 session 历史永久保存在进程内 Map。

## 会话复用

同一 runtime 内的 Coding Agent session 以会话 ID 为键复用，但仅保留最近的空闲 session。淘汰时释放 hooks 并 abort 旧 session；下一次访问通过持久 JSONL 重建上下文，active session 始终保留到 lease release。

新建空 Senera 会话不构造 runtime，也不建立 Pi JSONL。首个实际 `session.message` 通过 `create_if_missing` 原子建立 Senera 会话，Pi 只在 `leaseTurn()` 中 `open_or_create`。同一会话后续回合优先复用 persistent `AgentSession`，避免每轮重新读取和解析整棵 session tree。

产品层 fork 以 turn preparation 中持久化的 Pi boundary entry 为锚点。Session 层按稳定顺序同时获取 source/target admission，在内存构造目标快照并先写 durable fork journal；Pi 再使用 `SessionManager.forkFrom()` 复制原生树并 `branch()` 到该边界，Artifact 服务随后为目标追加 request-scoped owner。只有这些步骤都完成后，SQLite 才在一个 transaction 中写入目标 Conversation/run/preparation/event snapshot 并删除 journal，然后发布 `session.created` 与 `session.forked`。任何中途失败都会 reset 目标 Pi、释放目标 Artifact owner 并撤销 journal；启动恢复也会回滚未提交 journal，因此目标在最终 commit 前不可见。

已初始化会话支持原生 compact、runtime status 和 JSONL/HTML export。缓存中的会话直接复用，未缓存会话用短生命周期的管理 session 打开，操作结束即释放。WebSocket 只返回稳定统计 DTO 和相对导出路径；Pi 的绝对 session 文件路径不会穿过 Senera 协议边界。导出文件统一写入 workspace layout 的 `.senera/exports/sessions`。

## 项目上下文

`.senera/context/PROJECT.md` 是进入 Pi system prompt 的唯一工作区项目上下文文件。`DefaultResourceLoader` 禁用通用 context-file 扫描，通过 `agentsFilesOverride` 只注入该文件，避免意外读取仓库中的其他约定文件。文件使用 regular-file snapshot 读取并按存在性与内容生成 SHA-256 fingerprint；每轮 lease 都检测变化，变化后等待会话空闲并调用完整 `session.reload()`，因此下一轮立即生效，无需重启服务或创建新对话。

项目上下文属于 runtime-owned host state，普通 workspace 写入工具不能修改；它应由部署、用户或专门的受控管理入口维护。文件不存在表示没有项目级补充指令，不触发兼容回退或目录猜测。

自动压缩完全由 Coding Agent 根据模型 context usage 与原生 compaction 设置触发。Pi Proxy 返回给 Coding Agent 的 usage 必须衡量外层 messages、tools 和 assistant payload，内部 BAML 调用的 usage 只进入 Senera ledger。Senera 不再维护平行的压缩策略、压缩提示词或修复调用。

Pi Session JSONL 是 assistant message、tool call、tool result、分支和 compaction 的权威执行记录。Senera Conversation SQLite 只保存产品层用户消息和最终回答，不再复制 OpenAI transcript 或工具证据。工具结果的模型可见摘要保留在 Pi `toolResult`；完整 raw/projection/evidence/workspace 内容与 SHA-256 receipt 保留在 Artifact 服务。

原生 compaction 移除旧消息前，`session_before_compact` 从待摘要的 `toolResult.details.senera` 与 observation evidence 提取 Artifact URI、call ID、tool name 和可读 ref。压缩完成后写入分支内的隐藏 `senera.artifact_index` custom entry。该 entry 不进入模型上下文；后续 `context` hook 先让 observation projector 保住当前工具结果，再按模型窗口、输出保留量和当前 Pi 消息占用，从最近的 archived Artifact 开始装入剩余空间。已经在活动 tool result 中可见的 Artifact 不重复投影，装不下的旧引用只计入 `omittedArtifacts`，可通过 Memory 重新定位。索引绝不复制 raw result 或完整 workspace evidence，Schema 无效时发出诊断并拒绝部分数据。

## 工具并发边界

Pi 工具定义使用 `executionMode: "parallel"`，让同一批次的独立调用进入执行桥。安全串行化不由 Pi 的静态 per-tool 开关承担：Pi Core 只要在一个批次里看到任意 `sequential` 工具，就会把整个批次全部串行，无法表达“同资源冲突、不同资源并发”。

Coding Agent 每回合持有 `toolAccessGrant.authorizedToolNames` 的宿主工具定义，PiProxy 的 Planner 只投影 `AgentToolExposureState.exposedToolNames`，并把多个 `preferredToolNames` 稳定排在前面。ToolSearch 可在同一回合追加已授权工具；下一次 PiProxy 请求读取新的 exposure generation，无需重建会话。请求级 `tool_choice` 可以进一步收窄曝光集合，但不能扩大 grant。编译器、permission hook、执行桥和最终执行器共享同一授权与曝光状态，任一边界缺失 grant 都会关闭工具执行。

工具定义绑定 contract digest。MCP `tools/list_changed` 更新 registry 后，旧 Pi 回合若尝试调用同名但契约已变化的工具，会在执行器分派前失败；新目录只在后续回合以新的工具指纹和 Schema 进入 Coding Agent。

真实并发由 ToolRuntime 的资源租约调度器决定。工具在执行前根据 `Handler.Resources` 生成 shared/exclusive claim；重叠资源中任意一方为 exclusive 时等待，不重叠资源可以并发。无法可靠分类的调用使用全局独占租约。权限检查、参数校验和实际工具执行仍是权威边界，模型的 `dependsOn` 不能绕过资源租约。

## Skill 提示词投影

`DefaultResourceLoader` 是 Pi 会话内 Skill 发现、标准 frontmatter 校验、collision 诊断和资源重载的权威来源，加载 `.senera/skills` 与 `System/Skills`。Senera 不再维护平行的 Pi Skill 文件缓存或自造 Skill catalog；它只根据显式调用、语义匹配与学习证据产生活跃 Skill 身份。

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
- `PiCodingAgentSubstrateBehavior.test.ts` 覆盖真实 `AgentPiSubstrate`、本地模型代理、HostCapability、artifact、工具结果回灌和同一持久会话的 Skill 热重载。
- `PiSessionManagementBehavior.test.ts` 覆盖原生 fork、compaction 参数、稳定 stats DTO 和受控 JSONL/HTML 导出路径。
- `Session/PiSessionManagementBehavior.test.ts` 与 `SessionForkBehavior.test.ts` 覆盖管理事件、不可用状态和 SQLite/Pi 双存储原子回滚。
- `ToolResourceSchedulerBehavior.test.ts` 覆盖读读并发、读写串行、不同资源并发、公平等待和取消释放。
