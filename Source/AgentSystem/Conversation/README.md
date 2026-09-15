# Conversation 模块

`Conversation` 只保存产品层对话：用户消息与每轮最终助手回答。工具调用、工具结果和多步执行轨迹由 Pi Session JSONL 保存，证据内容由 Artifact 服务保存。

## 模块职责

- `AgentConversation`：定义 `user.message`、`assistant.decision` 两种条目及稳定 id 规则。
- `AgentConversationProjector`：把运行时事件投影成 conversation entry。
- `AgentConversationSequence`：按原始 entry 顺序选择每个 request 的权威 user/assistant 条目，不按 request 首次出现位置重新分组。
- `AgentConversationPolicy`：把产品对话物化成模型消息，并用统一 XML 协议投影历史/当前用户附件。
- `AgentPiConversationProjector`：仅在空 Pi Session 首次建立时导入已有产品对话；已存在的 Pi Session 不重复导入。

## 边界规则

- Conversation 只处理对话条目的结构、投影和物化，不负责数据库读写。
- 会话生命周期、运行中请求和前端事件属于 `Session`。
- Conversation 不保存 tool call、tool result、OpenAI transcript、planner journal 或 evidence 副本。
- Pi Session JSONL 是工具调用与执行轨迹的权威来源；Artifact manifest 是原始结果、投影、证据和工作区变更的权威来源。
- Memory 从当前已执行工具的 Artifact receipt 建立可检索 source，不反向解析 Conversation 复制证据。
- 同一 request 的重复 assistant entry 只保留带 run metadata 的权威项；相同权威级别使用最后一项。过滤后仍保持原始 entry 顺序，不能通过按 request 分组把较晚的 steer/follow-up 移到较早位置。
- 活动运行接收的 `steer` / `follow_up` 会作为独立 user entry 持久化，并在 metadata 中记录 `queue.parentRequestId` 与 `queue.mode`。关联关系来自显式 metadata，不按时间邻近或 request ID 格式猜测。
- queued message 的附件必须先由 `AgentConversationPolicy.renderCurrentUserMessage()` 投影为与普通当前输入相同的结构化 XML，再传给 Pi `steer()` / `followUp()`；不得使用 `JSON.stringify` 或只转发正文而丢失附件。
- `AgentConversationPolicy` 与 `AgentPiConversationProjector` 必须共享 `authoritativeConversationSequence()`，避免历史导入和非 Pi 消费者看到不同顺序。
