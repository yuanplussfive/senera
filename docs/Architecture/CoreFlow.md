# 核心链路导览

这篇文档用于快速理解 Senera 的主流程。改动主循环、规划器、工具执行、记忆、事件投影或前端会话状态前，先看这里。

## 一次请求的主路径

```text
用户输入
  -> Apps 入口
  -> AgentSessionManager / admission
  -> AgentLoop
  -> 当前输入的初始 Tool/Skill retrieval
  -> AgentTurnPreparationService
     (Skills + RootCommand + toolAccessGrant)
  -> AgentTurnPromptRenderer
  -> AgentPiTurnExecutor
  -> persistent Pi Coding Agent session
  -> local PiProxy HTTP + turn-context reader lease
  -> AgentPiAssistantCompiler / ActionPlanner / BAML
     (EvolveTurn, RepairControllerDecision, FillPiToolArguments ...)
  -> Pi Coding Agent 工具循环
  -> ToolRuntime / HostCapability / MCP
  -> Artifact + 领域事件
  -> Session SQLite 终态原子提交 + Memory learning
  -> WebSocket 发布
  -> 前端 Session Projector 更新界面
```

## 每层负责什么

`Apps/*` 是入口层，负责 终端、Server、Desktop 的启动、路径、配置来源和传输协议。这里不应该写规划、工具、记忆或 artifact 业务逻辑。

`AgentSystemRuntime` 是装配层，负责创建服务、加载配置、注册 System Tools、扫描 MCP packages 与 Skills。它可以知道有哪些服务，但不应该继续承载具体业务策略。

`AgentLoop` 是单回合编排层，负责初始化 runtime、准备能力、渲染提示词、启动一个 Pi turn 和生成终态事件。它没有平行的请求理解/路由状态机；Pi 内部的多步决策由 PiProxy compiler 和 ActionPlanner 驱动。

`AgentTurnPreparationService` 是确定性的回合准备层，负责激活 Skills、合并当前输入的检索结果与 Skill 推荐，并生成 RootCommand 和不可变 `toolAccessGrant`。准备快照与 runtime fingerprint、用户输入和合同版本绑定；这里不调用 BAML，也不生成首动作。

`AgentTurnPromptRenderer` 是 system prompt 投影层，负责把模板、工具摘要、Skill、预设和 RootCommand 渲染成 Pi 可消费的提示词。它不执行工具，也不修改授权状态。

`ActionPlanner` 是 PiProxy 使用的结构化模型调用层。`EvolveTurn` 根据当前 transcript、运行上下文和曝光中的 routing cards 返回 `Direct`、`AskUser` 或小型 `Execute` fragment；工具选定后，`FillPiToolArguments` 才读取权威 JSON Schema 物化参数。BAML 负责结构化输出，本地 parse、Zod/AJV 校验和定向 repair 负责最终合同。

`PiProxy` 是统一模型决策层。Pi 发出的 OpenAI-compatible 请求始终由 PiProxy 接收，再通过配置的模型端点调用 OpenAI、Claude、Google 或兼容服务，并由 BAML 编译成结构化 assistant message。运行时不根据供应商原生 tools 能力分流。

`Pi` 是工具循环和会话层。它消费 PiProxy 返回的结构化 assistant message，负责工具生命周期、权限预检、执行结果回填、流式事件和多步循环。供应商协议适配不进入 Pi 的工具执行逻辑。

Pi 会话创建与恢复是不同 disposition：新会话创建 JSONL，恢复会话打开已有 session tree。空闲 `AgentSession` 受 `AgentLoop.PiSessions.MaxCachedSessions` 约束；同一会话后续回合优先复用 persistent session。lease 的资源投影、session 打开和总耗时通过独立 `core.turn.lease.timing` trace 记录，不挤占 `core.turn.lease.completed` 的业务详情预算。

Pi 自动压缩由 Coding Agent 原生 compaction 生命周期负责。Pi Proxy 返回外层 wire context 的 usage，内部 BAML usage 只记录到 Senera ledger，避免用内部模型调用错误触发会话压缩。Senera 的 `context` hook 只在工具 observation 超出动态预算时做可恢复投影，不替代 session compaction。

状态按所有权分为四层：Conversation SQLite 保存用户消息和最终回答；Pi Session JSONL 保存 assistant/tool 的完整执行序列与分支；Artifact 服务保存 raw、projection、evidence、workspace diff、manifest 和完整性 receipt；Memory SQLite 保存指向产品对话与 Artifact/evidence 的学习 source。四层之间通过 request ID、call ID 和 Artifact URI 关联，不复制完整工具结果。

跨存储的历史修改使用 durable mutation saga。truncate/regenerate 先在 admission 锁内验证 request boundary，边界不存在时不触发 Pi、Memory 或 Artifact 副作用；随后先写 `session_history_mutations` journal，再执行 Pi rewind/reset、释放对应 Artifact owner、删除 Memory source，最后用 SQLite transaction 提交 Conversation 变更并删除 journal。SQLite 提交失败时 journal 保留，启动恢复会幂等重放清理。

fork 同时按稳定顺序获取 source/target admission，先在内存构造候选快照并写 `session_fork_mutations` journal，再 fork Pi 原生 session tree、为目标会话追加共享 Artifact owner，最后一次性发布目标 SQLite snapshot 并删除 journal。任何中途失败都会 reset 目标 Pi、释放目标 Artifact owner 并撤销 journal；目标会话在最终 commit 前不可见。Artifact manifest 使用兼容的 `sessionId` 与规范化 `sessionIds` 多 owner 表示共享归属，关闭或截断一个会话只释放该 owner，不删除仍被分支引用的证据。

Pi compaction 前从待摘要的 tool result 提取 Artifact 引用，压缩后将合并索引写为当前分支的 `senera.artifact_index` custom entry。它不直接参与模型上下文；`context` hook 在当前 tool observation 完成预算投影后，使用模型窗口减去输出保留量和活动消息占用得到真实剩余空间，只装入能够完整放下的最近 archived Artifact。活动消息已有的 URI 不重复，省略数量显式可见。这样 Pi 可以淘汰旧消息而不丢失可验证资料的入口，Artifact 内容也不会被重复写入 Session JSONL。

`ToolRuntime` 是工具执行层，负责校验本轮不可变 `toolAccessGrant`、保留 Pi toolCallId、运行宿主能力或 MCP process，并把结果交给 artifact、日志和 Pi observation。集合契约为 `preferred ⊆ exposed ⊆ authorized ⊆ registered`：RootCommand 授权当前回合可用的注册工具，初始检索只决定曝光子集，ToolSearch 可在同一回合追加已授权工具。Coding Agent 持有 authorized 定义，Planner/BAML 只看到 exposure snapshot，请求级 `tool_choice` 只能进一步收窄。

每个新用户轮次都按当前输入 fresh retrieval；相容的会话工具快照只是零命中时的 warm cache，直接回复产生的空集合不会覆盖上一次有效快照。回合准备把 grant、初始曝光集合、活动 Skills、RootCommand 与运行 fingerprint 一并持久化；配置或扩展合同变化会使旧快照失效。同一回合中，ToolSearch 可以按新的明确查询继续披露已授权工具，无需伪造第二个前置规划阶段。

MCP 客户端使用标准 `notifications/tools/list_changed` 能力协商。SDK 收到通知后自动重新请求 `tools/list`，宿主对新声明执行启动时相同的 Schema 预检，并按 server owner 事务替换 registry、刷新 ToolSearch。失败更新回滚到旧目录；活动回合携带的 contract digest 阻止旧参数执行新契约，新 Schema 从后续回合开始生效。

`Safety` 是授权层。注册工具合同与 OPA 先确定不可覆盖的执行边界；确定性拒绝不会进入语义审批。其余调用再由 Guardrail 补充语义风险，最终按 `deny > ask > allow` 合并。工具策略读取注册状态、审批声明、信任等级、权限和副作用；资源策略读取操作意图、规范路径包含关系、链接穿越和受保护目录等由宿主机检查器提供的事实。Rego 是唯一确定性业务规则源；随产品发布的 WASM 通过源码、数据和二进制哈希校验。策略产物缺失或损坏时只允许明确拒绝或请求人工确认，不运行另一套自动放行规则。

`ArtifactRecorder` 是可追溯证据层，负责写入工具输入、原始输出、摘要、证据、投影和工作区变更。模型和前端应该拿引用和摘要，不直接依赖临时进程输出。

`Memory` 是长期状态层，负责原始来源、候选记忆、晋升记忆、主动写入和回忆。记忆应该通过 source refs 和 repository 追溯，不应该重新临时解析聊天记录。

`AgentWebSocketServer` 是事件传输层，负责把后端领域事件序列化给前端。前端通过 projector 更新 UI 状态，不反向复制后端决策逻辑。

## 审批生命周期

OPA 只负责给出 `allow`、`deny` 或 `requires-approval` 策略决定；需要人工确认时，`AgentApprovalRuntime` 成为唯一状态权威。审批使用 `sessionId + requestId + step + toolCallId + batchId + approvalId` 关联会话、运行、步骤、调用和并发批次。同一工具调用的同类审批会去重，并行工具调用仍保持独立，不共享一个模糊的全局“允许”状态。

前端提交的是声明式决定，而不是伪造服务端终态：

- `approve_once`：仅放行当前审批，结果 disposition 为 `proceed`。
- `approve_session`：放行当前审批，并在当前会话内缓存同一主体的授权。
- `deny`：拒绝当前操作，Agent 可以接收拒绝结果并继续，disposition 为 `continue`。
- `deny_and_interrupt`：拒绝并取消当前运行，disposition 为 `interrupt`。

服务端把决定解析为 `approved`、`denied`、`cancelled` 或 `expired` 终态，并始终发出 `approval.resolved`。取消、会话关闭、运行结束和过期不能静默删除待审批记录。审批事件进入运行历史，因此重连后由 projector 重建；按钮提交中的状态保存在集中 store，不依赖会因虚拟列表重挂载而丢失的组件局部状态。

活动运行同样由服务端判定。`session.list.snapshot` 为每个实时运行的会话携带 `activeRequestId`；历史回放可以恢复旧的 `run.started`，但回放收尾只保留与该权威 ID 一致的 running run，其余没有终止事件的历史运行按中断收口。前端的 `waiting_for_approval` 只是一种由未解决审批投影出来的展示状态，不是新的后端运行状态机。

模型端点的 `TimeoutSeconds` 约束单次模型网络请求，`MaxRequestSeconds` 才约束完整 Pi prompt/工具循环。人工审批等待可能跨越多次网络调用，因此不能用单次网络超时包住；当 `MaxRequestSeconds` 设为禁用值时，审批等待只受取消信号和审批自身过期策略控制。

## OPA 策略产物

工具审批和资源访问规则分别维护在 `Source/AgentSystem/Safety/AgentToolApprovalPolicy.rego` 与 `AgentResourceAccessPolicy.rego`，规则文本和配置集合维护在同目录的 `AgentToolApprovalPolicy.data.json`。执行边界不是一个可降级策略：工具 manifest 声明可选目标，双目标工具由公开的 `executionTarget` 参数明确选择；Sandbox 失败或被部署禁用时，该调用失败，不会改在 Local 执行。资源策略不自行解释路径：`SeneraWorkspaceBoundary` 先用操作系统 `realpath`/`lstat` 生成结构化事实，OPA 决定是否允许，执行环境在真正读写和启动进程前再次执行机械边界检查。修改任一策略源或数据文件后，使用 OPA 编译器重新生成产物：

```bash
npm run policy.compile
```

OPA 编译器版本、平台产物名与 SHA-256 统一维护在 `Build/OpaToolchain.json`。`npm run policy.compile` 和 `npm run policy.verify` 会按当前平台将固定版本下载到被忽略的 `.cache/opa/`，先完成 SHA-256 校验才执行；无需全局安装，也不在仓库中提交二进制。受控构建环境可通过 `SENERA_OPA_BINARY` 显式提供同版本编译器。编译会同时更新可移植的 `.wasm` 和 artifact manifest；CI 使用 `npm run policy.verify` 重新编译并逐字节检查提交产物。普通用户、Docker 和桌面端只加载已提交并校验过的产物，不在应用启动时下载或编译 OPA。

## 新能力的落地规则

新增能力尽量遵循这条路径：

```text
契约
  -> 运行时实现
  -> 模型/前端/artifact/日志投影
  -> 验证脚本
```

不要通过“主循环直接 import 一个具体工具、模型供应商、UI 状态”的方式加能力。优先让能力通过 System Tool、MCP、Skill、runtime service、配置 schema、事件协议或前端 feature 边界注册进系统。

## 必跑验证

改核心链路时至少跑：

```bash
npm run check.types
npm run build
npm run verify.suite -- workspace core
npm run test.frontend
```

大改前后跑完整本地套件：

```bash
npm run verify.all
```
