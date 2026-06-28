# Conversation 模块

`Conversation` 负责把用户消息、助手决策、工具结果、规划日志和证据记忆组织成可持久化、可回放、可投喂模型的对话条目。

## 模块职责

- `AgentConversation`：定义 conversation entry 的结构化类型和稳定 id 生成规则。
- `AgentConversationProjector`：把运行时事件投影成 conversation entry。
- `AgentConversationPolicy`：根据历史裁剪策略，把 conversation entry 物化成模型消息。

## 边界规则

- Conversation 只处理对话条目的结构、投影和物化，不负责数据库读写。
- 会话生命周期、运行中请求和前端事件属于 `Session`。
- 工具证据、planner journal 的语义来自 `Memory`，Conversation 只保存和重放结构。
