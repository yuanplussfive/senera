# SessionPersistence 模块

`SessionPersistence` 负责会话 SQLite 存储的 schema、SQL 语句和行级编解码。它不拥有会话业务流程，只处理持久化边界。

## 模块职责

- `AgentSessionSqlSchema`：安装和迁移 SQLite 表结构。
- `AgentSessionSqlStatements`：集中准备 SQL statements。
- `AgentSessionSqlRows`：数据库行类型。
- `AgentSessionCodec`：兼容出口，聚合会话持久化编解码函数。
- `AgentSessionJsonCodec`：安全 JSON 解析和基础字段读取。
- `AgentConversationEntryCodec`：产品对话的 `user.message`、`assistant.decision` 与数据库行互转。
- `AgentRunSnapshotCodec`：run snapshot 与数据库行互转。
- `InMemorySessionRepository`：测试和内存场景的聚合 repository；只管理 Session metadata、mutation journal、command receipt 和 profile。
- `InMemorySessionHistoryStore`：组合内存历史子存储并提供与 SQLite 相同的 repository 历史语义。
- `InMemorySessionEntryStore` / `InMemorySessionTraceStore` / `InMemorySessionRunHistoryStore`：分别独占 entry/request、trace run、snapshot revision/event/preparation 索引，禁止跨模块直接读取彼此的 Map。
- `Session/AgentSqliteSessionRepository` 是聚合 transaction boundary；`Session/AgentSqliteSessionHistoryStore` 组合本模块提供的 statements/codec，集中实现 conversation、trace、snapshot、preparation 和 event 的历史读写。

## 历史读取

- 会话目录通过聚合查询返回 metadata、原始 entry count 和按 `(kind, request_id)` 去重后的 message count，不装载 conversation JSON。启动恢复使用独立 metadata 查询，不能为 lifecycle 检查支付 entry 聚合成本。
- 标题回退通过 `loadFirstUserMessage` 按 sequence 读取首条 `user.message`；该查询属于 catalog reader，不得退化为完整 conversation 读取后再 `find`。
- 单会话回放先捕获 entry `sequence`、step trace `rowid`、run snapshot `revision_id` 和 run event 自增 `id` 高水位。entries、完整 step-trace runs、run snapshots 和 run events 都使用 keyset cursor，不使用 `OFFSET`，也不在业务层先全量读取再切数组。
- step trace 以 `(turn_sequence, request_id)` 作为 run cursor；同一个 run 的 traces 必须留在同一页。`rowid` 只作为当前 SQLite snapshot 的内部高水位，不暴露到 WebSocket 协议。
- `run_snapshots` 保存每个 request 的当前状态，`run_snapshot_revisions` 由触发器追加 insert/update/delete 修订。回放在捕获的 `revision_id` 内选择每个 request 的最后修订，因此 `running -> terminal` 更新不会污染已经开始的 replay；delete tombstone 使 truncate 前已捕获的回放仍可完成。删除整个 session 时同步清理修订。
- run snapshot 的 `history_sequence` 在每个 session 内单调分配，upsert 不得改变它或 `started_at`。修订保留该顺序，`(status, session_id, history_sequence)` 仍支持启动时只扫描当前 orphaned running runs。
- 页内关联使用 SQLite `json_each` 参数表批量查询 request IDs，并受 repository 最大页尺寸约束；禁止拼接动态 SQL、逐 request 查询或回退到全量加载后筛选。
- 分页查询使用 `pageSize + 1` lookahead 判断是否存在后页。即使持久化 JSON 损坏而被 codec 丢弃，`nextCursor` 仍按原始 row 推进，避免死循环、重复和跳过后续有效记录。
- repository 页尺寸由 `AgentSessionHistoryPaging` 统一校验。调用方不能通过任意大 limit 绕过内存边界。
- repository 把 metadata、catalog、paged history 和 full history reader 拆成独立端口。历史回放只能依赖 paged history；完整 readers 不得作为分页或 request-scoped 查询的替代实现。
- request boundary、request ID 列表、单 request run event 和 fork prefix 都有专用 repository 查询。fork 先定位 through-request 的持久化 sequence，再只读取该前缀所属的 entries、traces、snapshots、preparations 和 events；不得把整个 session 读入内存后筛选。
- `run_events(session_id, request_id, id)` 是 request replay 的复合索引。request ID 不是跨 session 的唯一键，查询必须同时约束 session ID。

## Durable mutation journals

Conversation SQLite、Pi Session JSONL、Artifact 文件和 Memory SQLite 不能组成一个数据库事务。Session 因此使用 SQLite journal 把不可恢复的“先做外部副作用、后提交产品状态”改造成可重放 saga：

- `session_history_mutations`：记录 truncate/regenerate 的 request boundary、Pi `none/reset/rewind` 动作和可选 branch entry。journal 落盘后才允许修改 Pi、Artifact owner 和 Memory；最终 Conversation truncate 与 journal 删除在同一 SQLite transaction 中提交。
- `session_fork_mutations`：记录 source/target、through-request boundary、Pi `none/fork` 动作和 branch entry。目标会话快照不提前发布；Pi fork 与 Artifact owner retain 完成后，目标 snapshot 和 journal 删除在同一 transaction 中提交。

进程重启时，history journal 幂等重放并完成 commit；未提交的 fork journal 则回滚目标 Pi 与 Artifact owner 后删除。journal row 是恢复协议，不是遥测日志，新增字段或动作必须同时更新 repository 接口、SQLite statements、row codec、migration、snapshot、contract/runtime 产物和恢复测试。

## 边界规则

- SQLite 表结构变化只放在 schema/migration 层。
- JSON 容错只在持久化读取边界处理，业务层接收结构化对象。
- 聚合仓储负责跨 metadata、command receipt、journal 与历史表的事务；HistoryStore 只拥有历史表操作，不能自行删除 journal、提交 command 状态或关闭连接。
- 新增历史数据类型时，应先扩展 repository 窄端口、statement/row/codec 和 HistoryStore，再由聚合仓储委托；禁止把历史 SQL 重新写回 `AgentSqliteSessionRepository`。
- `Scripts/BackendTests/Session/SessionRepositoryConformance.test.ts` 是所有 `AgentSessionRepository` 实现共享的行为门禁。新增实现或修改 sequence、去重、分页游标、revision/tombstone、截断、command receipt、mutation journal 语义时，必须扩展同一组 adapter-neutral 断言；不得只在某个实现的专属测试中定义通用合同。
- SQLite 专属测试只覆盖迁移、SQL 约束、损坏行恢复和事务故障注入等存储机制。共享可观察行为必须进入 conformance suite，避免内存实现和 SQLite 实现分别维护相似但不等价的断言。
- 新增 conversation entry kind 时，同时补 entry 编解码和对应验证脚本。
- 工具调用、工具结果和 Pi compaction 不写入 Conversation SQLite；它们属于 Pi Session JSONL。
- Artifact 与 evidence 内容不复制进 session row；SQLite 只保存产品对话、运行快照、事件和业务元数据。
- 跨存储副作用前必须先写 durable journal。不能依赖进程内 flag、finally 补偿或“最可能成功”的执行顺序代替恢复协议。
- mutation 的最终产品状态与 journal 删除必须在同一个 SQLite transaction；否则崩溃窗口会产生已发布半状态或丢失恢复线索。
- `session_fork_mutations.target_session_id` 唯一标识一个待发布目标，source/target admission 负责阻止并发创建、关闭或反向 fork 穿过该边界。
- migration SQL 是唯一 schema 来源；修改后运行 `npm run generate.database-contracts` 并用 `npm run verify.database-contracts` 检查生成 snapshot、contract 和 runtime 文件。
