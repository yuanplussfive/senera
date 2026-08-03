# ToolRuntime 模块

`ToolRuntime` 负责工具运行时合同、宿主能力与 MCP 工具调度、生命周期事件、结果投影和工作区变更捕获。

## 模块职责

- `AgentToolAccessGrant`：构造并深冻结本轮安全授权与初始曝光集合，强制 `preferred ⊆ exposed ⊆ authorized`。
- `AgentToolExposureState`：维护当前回合的曝光 generation。ToolSearch 只能把已授权工具追加到 `exposed`，并可提升已曝光工具的排序；未知或未授权名称不会进入模型上下文。
- `AgentToolCallExecutor`：依据本轮 grant 校验工具授权、捕获工作区变更并发出 planned/started/completed/failed/detail 事件。
- `AgentToolRunner`：先按统一 JSON Schema 校验参数，再按 `Handler.Kind` 调度 HostCapability 或 MCP 工具，并对成功结果执行 output schema 校验。
- `AgentToolDeadline`：把 `ToolExecution.TimeoutSeconds` 投影为 System Tool 与 MCP Tool 共用的宿主 deadline，组合回合取消并限制工具级请求只能缩短预算。
- `AgentToolHostCapabilityRegistry`：注册 shell、patch、execution resource、memory 等宿主能力。
- `AgentMcpToolRunner` / `AgentMcpToolClientPool`：执行 MCP 工具；`Persistent` 复用按 server 与安全 profile 隔离的连接，`OneShot` 每次调用独立连接，`RemoteJob` 使用 MCP Tasks 投影长任务状态、结果与取消。
- `AgentToolExecutionReporter`：把宿主输出和 MCP progress 统一投影为增量工具事件。
- `AgentToolProcessEnvelope` / `AgentToolProcessTypes`：统一成功与失败结果，不承担私有工具进程协议。
- `AgentToolResultOutcome`：把工具终态拆成执行状态、评估状态和输出可用性。`Runtime.ResultAssessment` 在调用前决定是否解释进程退出语义；失败同时携带稳定的 code、kind、source 与 retryable。
- `AgentToolCatalogProjector` / `AgentToolTagCatalogProjector`：把注册工具投影成模型和 UI 可读目录。
- `AgentToolObservationProjection` / `AgentToolObservationRenderer`：把工具调用和工具结果投影成 planner timeline 可读观察。
- `AgentToolResourceClaimProjector` / `AgentToolResourceScheduler`：把 manifest 资源声明投影为运行时租约，并按资源关系协调并发。
- `AgentWorkspaceApplyPatchContract`：定义工作区 patch 的参数 schema 和有判别字段的 operation union，是新增操作类型时的唯一合同入口。
- `AgentWorkspacePatchPlanBuilder`：解析与校验路径、捕获文件前置条件、应用 hunk，并把声明式 operation 编译为无副作用的事务计划。
- `AgentWorkspaceApplyPatchRuntime`：作为宿主能力入口编排参数校验、规划、托管扩展预检、权限提升和事务提交，不包含具体 operation 分支。
- `AgentWorkspacePatchTransaction`：在提交前重新校验捕获的文件状态，并负责有补偿能力的目录和文件变更；规划器不得直接写入工作区。

## 工作区 Patch 边界

工作区 patch 按 `Contract -> PlanBuilder -> ExtensionPreflight -> Transaction` 分阶段执行。Runtime 是唯一组合入口：dry-run 完成规划和扩展候选校验但不提交；正式执行在预检通过后重新校验所有前置条件，再以一个事务批次提交。托管 Skill/MCP 目录的写入权限只在计划中的规范化路径明确落入对应资源域时提升，规划器和事务层都不根据 payload 字段或工具名猜测权限。

新增 operation 时必须先扩展判别联合和规划器分派，再由现有事务原语表达写入、删除或目录变更。禁止绕过 `WorkspacePatchPlan` 直接操作执行环境，也禁止在 Runtime 增加特定路径、文件名或扩展类型的 operation 分支。operation summary、JSON Pointer 诊断、changed path 排序和提交前置条件是对外行为合同，重构时必须保持稳定。

## 资源租约

工具通过 `Handler.Resources` 声明资源 capability、参数 JSON Pointer 和 capability 参数。具体 capability 同时负责参数投影和资源 claim，因此通用调度器不包含工具名、参数名或文件路径特例。

claim 由资源域、规范化身份和访问模式组成。资源域定义两个身份是否重叠：工作区路径域复用统一路径边界关系，上传域使用精确身份；调度器只消费该契约。显式声明存在但字段缺失、capability 未知或 claim 投影异常时，调用保守降级为全局独占，实际执行阶段继续产生权威参数诊断。未声明资源的 HostCapability 仍全局独占；未声明资源的 MCP 工具按 server 精确域隔离，并依据标准 `readOnlyHint` 选择共享或独占访问。

| 资源关系                | 调度结果 |
| ----------------------- | -------- |
| 同一或父子资源，读 + 读 | 并发     |
| 同一或父子资源，读 + 写 | 串行     |
| 同一或父子资源，写 + 写 | 串行     |
| 不重叠资源              | 并发     |
| 任一调用无法可靠分类    | 全局串行 |
| 同 MCP server 只读调用  | 并发     |
| 同 MCP server 涉及写入  | 串行     |
| 不同 MCP server         | 并发     |

等待队列允许互不冲突的调用前进，但后来的读取不能绕过更早的冲突写入，避免写入饥饿。取消等待必须立即移除 waiter；执行结束、失败或取消都必须在 `finally` 中释放租约。

## 边界规则

- ToolRuntime 不负责工具搜索排序；搜索和学习属于 `ToolSearch`。
- ToolRuntime 不负责规划要调用哪些工具；PiProxy 通过 `ActionPlanner` 编译下一步决策和参数，ToolRuntime 只消费已经过合同校验的调用。
- 集合契约是 `preferred ⊆ exposed ⊆ authorized ⊆ registered`。`loadedToolNames` 只形成初始 `exposed`；RootCommand 的 `authorized` 才是当前回合不可扩大的安全边界。
- Pi 可以持有全部 authorized 工具的宿主定义，但 Planner/BAML 只接收当前 exposure snapshot。ToolSearch 成功后更新同一回合的 exposure，下一次模型决策立即看到新工具，无需新会话或下一轮用户消息。
- 执行器同时校验授权名称与回合绑定的 contract digest。MCP 目录在活动回合中变化时，不允许用旧 Schema 生成的参数执行新契约。
- 工具执行产物的落盘策略属于 `Artifacts`，ToolRuntime 只产生结构化运行结果。
- 工具名、参数字段和路径语义不得写进通用调度器分支。扩展资源并发语义时注册新的 resource capability，由 capability 投影参数和 claim；调度器只比较规范化 claim。
- `ExecutedToolCallResult.outcome` 是生命周期事件、Pi observation、Artifact、Planner 和工具学习唯一可用的终态合同。`execution.status`、`assessment.status`、`output.availability` 分别描述执行事实、结果评估和输出完整性，任何一轴都不能代替另外两轴。
- `Runtime.ResultAssessment=ProcessExit` 允许执行边界把非零退出码或信号评估为失败；`Unassessed` 始终透传退出码、信号、stdout 和 stderr，不宣称成功或失败。超时、取消、无法启动、无效协议响应、HostCapability typed failure 与 MCP `isError` 在两种策略下都仍是失败。
- 业务 payload 中名为 `error` 的字段以及 `null`、空字符串、空数组或空对象都不能改变评估状态。下游不得检查 payload 字段、错误文本、退出码或 MCP 私有形状重新猜测失败。
- 工具学习只把明确的 `success` 当作正向样本。DAG 后继依据 `output.availability` 判断能否消费前序输出；失败或未评估状态仍保留在计划历史中，不会被改写为成功。
- `retryable` 只描述失败是否具有瞬态重试价值，不授权自动重放。任何重试仍必须依据工具幂等性、已发生副作用和当前权限重新决策。
- 外部工具使用 MCP 原生 request cancellation 和 progress notification；不得通过 stdout 自定义控制帧。
- 同步工具调用受宿主 `ToolExecution.TimeoutSeconds` 端到端约束。工具参数和 Server 上游配置只能缩短该预算，不能延长宿主 deadline；长任务必须使用 execution resource 或 MCP Tasks。
- `RemoteJob` 的总寿命不受同步调用 deadline 限制；任务创建、状态轮询、事件回放和结果读取各自使用统一的 MCP 请求超时，并始终响应回合取消。
- `Runtime.Lifecycle` 决定 MCP server 是否复用，manifest 声明与实际执行策略必须一致。
- MCP stdio 关闭使用 `ToolExecution.Resources.TerminationGraceSeconds` 投影的统一宽限期，依次执行 stdin close、terminate 和 force-kill；传输层不得另设固定等待时间。
- `Execution.Workspace` 不是并发声明；是否能并发必须来自具体资源 claim。只声明 `ReadOnly` 不能证明网络或外部系统没有副作用。
