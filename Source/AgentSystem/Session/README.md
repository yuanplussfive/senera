# Session 模块

`Session` 负责会话生命周期、运行中请求、历史回放、会话事件和会话仓储契约，是前端与 Agent 主循环之间的状态边界。

## 模块职责

- `AgentSession`：定义会话状态、活动请求和快照结构。
- `AgentSessionManager`：对外暴露会话 API，负责装配 Session 内部协作者。
- `AgentSessionRunCoordinator`：协调单轮请求运行、取消、活动 run 状态和记忆学习触发。
- `AgentSessionRunProjection`：生成本轮 user entry、模型消息、step trace 和 conversation 合并结果。
- `AgentSessionRunSnapshotWriter`：统一写入 running、completed、cancelled、failed 和重启恢复快照。
- `AgentSessionHistoryReplay`：把持久化 conversation、step trace 和 run event 投影为历史回放事件。
- `AgentSessionTitleProjector`：从会话条目生成列表标题。
- `AgentSessionStore`：管理内存缓存，并通过仓储接口持久化会话与运行轨迹。
- `AgentSessionRepository`：会话仓储接口、run snapshot 和 step trace 持久化契约。
- `AgentSqliteSessionRepository`：SQLite 会话仓储实现入口。
- `AgentSqliteSessionMapper` / `AgentSqliteSessionTraceStore`：SQLite row 到 session 的投影、标题恢复和 turn artifacts 原子落盘。
- `AgentSessionEventFactory` / `AgentSessionEventTypes`：生成和描述会话层事件。

## 边界规则

- Session 可以调度 `Loop`，但不实现模型调用、工具执行或规划算法。
- 对话条目的结构与物化属于 `Conversation`。
- SQLite row、codec、schema、statement 仍由 `SessionPersistence` 管理，Session 只暴露仓储接口和实现入口。
