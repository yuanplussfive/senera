# ToolRuntime 模块

`ToolRuntime` 负责工具运行时合同、宿主能力与 MCP 工具调度、生命周期事件、结果投影和工作区变更捕获。

## 模块职责

- `AgentToolCallExecutor`：校验可见工具、捕获工作区变更并发出 planned/started/completed/failed/detail 事件。
- `AgentToolRunner`：按 `Handler.Kind` 声明式调度 HostCapability 或 MCP 工具。
- `AgentToolHostCapabilityRegistry`：注册 shell、patch、execution resource、memory 等宿主能力。
- `AgentMcpToolRunner` / `AgentMcpToolClientPool`：执行 MCP 工具；`Persistent` 复用按 server 与安全 profile 隔离的连接，`OneShot` 每次调用独立连接，`RemoteJob` 使用 MCP Tasks 投影长任务状态、结果与取消。
- `AgentToolExecutionReporter`：把宿主输出和 MCP progress 统一投影为增量工具事件。
- `AgentToolProcessEnvelope` / `AgentToolProcessTypes`：统一成功与失败结果，不承担私有插件进程协议。
- `AgentToolCatalogProjector` / `AgentToolTagCatalogProjector`：把注册工具投影成模型和 UI 可读目录。
- `AgentToolObservationProjection` / `AgentToolObservationRenderer`：把工具调用和工具结果投影成 planner timeline 可读观察。

## 边界规则

- ToolRuntime 不负责工具搜索排序；搜索和学习属于 `ToolSearch`。
- ToolRuntime 不负责规划要调用哪些工具；工具调用规划属于 `ActionPlanner`。
- 工具执行产物的落盘策略属于 `Artifacts`，ToolRuntime 只产生结构化运行结果。
- 外部插件使用 MCP 原生 request cancellation 和 progress notification；不得通过 stdout 自定义控制帧。
- `Runtime.Lifecycle` 决定 MCP server 是否复用，manifest 声明与实际执行策略必须一致。
- MCP stdio 关闭使用 `ToolExecution.Resources.TerminationGraceSeconds` 投影的统一宽限期，依次执行 stdin close、terminate 和 force-kill；传输层不得另设固定等待时间。
