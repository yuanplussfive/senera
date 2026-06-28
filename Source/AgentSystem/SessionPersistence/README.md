# SessionPersistence 模块

`SessionPersistence` 负责会话 SQLite 存储的 schema、SQL 语句和行级编解码。它不拥有会话业务流程，只处理持久化边界。

## 模块职责

- `AgentSessionSqlSchema`：安装和迁移 SQLite 表结构。
- `AgentSessionSqlStatements`：集中准备 SQL statements。
- `AgentSessionSqlRows`：数据库行类型。
- `AgentSessionCodec`：兼容出口，聚合会话持久化编解码函数。
- `AgentSessionJsonCodec`：安全 JSON 解析和基础字段读取。
- `AgentConversationEntryCodec`：conversation entry 与数据库行互转。
- `AgentPlannerRecordCodec`：planner journal、planner state snapshot、tool evidence memory 的 record 恢复。
- `AgentRunSnapshotCodec`：run snapshot 与数据库行互转。
- `InMemorySessionRepository`：测试和内存场景用 repository。

## 边界规则

- SQLite 表结构变化只放在 schema/migration 层。
- JSON 容错只在持久化读取边界处理，业务层接收结构化对象。
- 新增 conversation entry kind 时，同时补 entry 编解码和对应验证脚本。

