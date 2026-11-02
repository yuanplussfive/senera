# Conversation 模块

`Conversation` 只保存产品层对话：用户消息与每轮最终助手回答。工具调用、工具结果和多步执行轨迹由 Pi Session JSONL 保存，证据内容由 Artifact 服务保存。

## 模块职责

- `AgentConversation`：定义 `user.message`、`assistant.decision` 两种条目及稳定 id 规则。
- `AgentConversationProjector`：把运行时事件投影成 conversation entry。
- `AgentConversationPolicy`：只为运行中的 `steer` / `follow_up` 渲染当前用户消息及附件。
- Pi 原生 JSONL 保存模型消息、思考、工具调用和工具结果；`Conversation` 只服务产品界面和审计，不回写为 Pi 上下文。

## 边界规则

- Conversation 只处理产品对话条目的结构和投影，不负责数据库读写或模型历史构造。
- 会话生命周期、运行中请求和前端事件属于 `Session`。
- Conversation 不保存 tool call、tool result、OpenAI transcript、planner journal 或 evidence 副本。
- Pi Session JSONL 是工具调用与执行轨迹的权威来源；Artifact manifest 是原始结果、投影、证据和工作区变更的权威来源。
- Memory 从当前已执行工具的 Artifact receipt 建立可检索 source，不反向解析 Conversation 复制证据。
- 活动运行接收的 `steer` / `follow_up` 会作为独立 user entry 持久化，并在 metadata 中记录 `queue.parentRequestId` 与 `queue.mode`。关联关系来自显式 metadata，不按时间邻近或 request ID 格式猜测。
- queued message 的附件必须先由 `AgentConversationPolicy.renderCurrentUserMessage()` 投影为与普通当前输入相同的结构化 XML，再传给 Pi `steer()` / `followUp()`；不得使用 `JSON.stringify` 或只转发正文而丢失附件。
- 产品层历史绝不重新写入 Pi Session；Pi JSONL 只接受 Pi 原生追加的当前消息、思考、工具调用、工具结果和回答。
