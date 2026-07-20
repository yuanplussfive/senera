# 核心链路导览

这篇文档用于快速理解 Senera 的主流程。改动主循环、规划器、工具执行、记忆、事件投影或前端会话状态前，先看这里。

## 一次请求的主路径

```text
用户输入
  -> Apps 入口
  -> AgentSystemRuntime 装配运行时
  -> AgentLoop 驱动步骤
  -> TurnUnderstanding 改写当前用户意图
  -> InteractionRoute 选择直接回复或工具循环
  -> ActionPlanner 生成 turn understanding + 首个权威动作
  -> PromptContextBuilder 组装模型上下文
  -> Pi Harness 驱动模型回复与工具循环
  -> PiProxy+BAML 一次性消费首动作；工具结果后继续编译后续动作
  -> ToolCallExecutor / 宿主能力 / 插件进程
  -> ArtifactRecorder 记录证据包
  -> Memory Learning 更新记忆
  -> Final Answer
  -> WebSocket 事件投影
  -> 前端 Session Projector 更新界面
```

## 每层负责什么

`Apps/*` 是入口层，负责 终端、Server、Desktop 的启动、路径、配置来源和传输协议。这里不应该写规划、工具、记忆或 artifact 业务逻辑。

`AgentSystemRuntime` 是装配层，负责创建服务、加载配置、扫描插件、注册能力。它可以知道有哪些服务，但不应该继续承载具体业务策略。

`AgentLoop` 是步骤驱动层，负责理解、路由、渲染提示词、启动 Pi turn 和收口最终回复。它消费 runtime services，并发出领域事件。

`ActionPlanner` 是结构化规划层，负责当前轮理解和交互路由。BAML 负责生成结构化输出，本地 schema 校验负责兜住最终形态。规划前先把会话已激活工具、Bootstrap 工具和已激活 Skill 的推荐工具合并成同一候选集合；Planner、BAML 校验和随后 Pi turn 都消费这份集合。模型若选中注册表中存在但尚未激活的动态工具，宿主只允许做一次声明式提升并重新规划，未知工具仍按结构错误处理。

`PromptContextBuilder` 是上下文投影层，负责把工具、技能、预设、记忆、运行状态投影成模型能吃的上下文。它不执行工具，也不修改运行状态。

`PiProxy` 是统一模型决策层。Pi 发出的 OpenAI-compatible 请求始终由 PiProxy 接收，再通过配置的模型端点调用 OpenAI、Claude、Google 或兼容服务，并由 BAML 编译成结构化 assistant message。运行时不根据供应商原生 tools 能力分流。

`Pi` 是工具循环和会话层。它消费 PiProxy 返回的结构化 assistant message，负责工具生命周期、权限预检、执行结果回填、流式事件和多步循环。供应商协议适配不进入 Pi 的工具执行逻辑。

Pi 会话创建与恢复是不同 disposition：新会话直接创建 JSONL，恢复会话才扫描持久 metadata。打开的 session tree 与 idle harness 共享 `AgentLoop.PiSessions.MaxCachedSessions` 容量策略；同一会话后续回合优先复用 harness 持有的 persistent session，避免重新读取并解析完整 JSONL。lease 的投影、session 打开、历史检查、harness 获取和总耗时通过独立 `core.turn.lease.timing` trace 记录，不挤占 `core.turn.lease.completed` 的业务详情预算。

Pi 自动压缩先生成不可变 `AgentPiCompactionPlan`，再决定 `compact`、`skip` 或 `reduce_context_overhead`。模型上报 usage 表示完整请求压力，包含系统提示词、工具 schema、运行时上下文和会话消息；Pi session branch 的本地估算才表示真正可压缩的历史。两者之差记录为固定上下文开销，不能用压缩聊天历史来解决。只有分支历史或消息数达到水位，并且 Pi `prepareCompaction()` 产生 `messagesToSummarize` 或 `turnPrefixMessages` 时才调用 `harness.compact()`。计划携带 leaf ID，hook 消费前会再次校验分支未变化。

完整请求压力较高但分支历史较小时，运行时返回 `reduce_context_overhead/fixed_overhead_dominant` 并继续当前轮，由工具投影、schema 预算和运行时上下文策略负责后续收敛；不会把它提升为历史 hard limit。真正的分支历史超过 hard limit 且压缩失败时才阻止继续。`compaction.checked`、`compaction.skipped`、`compaction.started`、`compaction.completed` 和 `compaction.failed` trace 分别记录计划、原因、指标和结果。

`ToolRuntime` 是工具执行层，负责校验可见工具、保留 Pi toolCallId、运行宿主能力或插件进程，并把结果交给 artifact、日志和 Pi observation。每次成功准备都会把 `loadedToolNames` 与运行 fingerprint 写入会话工具快照；同一会话后续回合只在 fingerprint 相容时继承，配置或插件合同变化会自然丢弃旧快照并重新发现。

`Safety` 是授权层。Manifest 与 OPA 先确定不可覆盖的执行边界；确定性拒绝不会进入语义审批。其余调用再由 Guardrail 补充语义风险，最终按 `deny > ask > allow` 合并。工具策略读取插件注册状态、Manifest 审批声明、信任等级、权限和副作用；资源策略读取操作意图、规范路径包含关系、链接穿越和受保护目录等由宿主机检查器提供的事实。Rego 是唯一确定性业务规则源；随产品发布的 WASM 通过源码、数据和二进制哈希校验。策略产物缺失或损坏时只允许明确拒绝或请求人工确认，不运行另一套自动放行规则。

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

工具审批、执行降级和资源访问规则分别维护在 `Source/AgentSystem/Safety/AgentToolApprovalPolicy.rego`、`AgentExecutionFallbackPolicy.rego` 与 `AgentResourceAccessPolicy.rego`，规则文本和配置集合维护在同目录的 `AgentToolApprovalPolicy.data.json`。资源策略不自行解释路径：`SeneraWorkspaceBoundary` 先用操作系统 `realpath`/`lstat` 生成结构化事实，OPA 决定是否允许，执行环境在真正读写和启动进程前再次执行机械边界检查。修改任一策略源或数据文件后，使用 OPA 编译器重新生成产物：

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

不要通过“主循环直接 import 一个具体工具、模型供应商、UI 状态”的方式加能力。优先让能力通过插件、runtime service、配置 schema、事件协议或前端 feature 边界注册进系统。

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
