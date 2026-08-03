# Session 模块

`Session` 负责会话生命周期、运行中请求、历史回放、会话事件和会话仓储契约，是前端与 Agent 主循环之间的状态边界。

## 模块职责

- `AgentSession`：定义会话状态、活动请求和快照结构。
- `AgentSessionManager`：对外暴露会话 API，负责装配 Session 内部协作者。
- `AgentSessionAdmissionCoordinator`：按 session ID 串行化公开操作；多会话操作对去重后的 ID 稳定排序后依次取锁，避免 fork 死锁。
- `AgentSessionMessageCoordinator`：在 admission 内完成消息查找/按需创建、busy 判定、活动 run 排队和新 turn 启动；重生成只通过其窄 admission 端口复用消息接纳。
- `AgentSessionHistoryController`：串行化 history replay、truncate 和 regenerate，管理重生成代际令牌、lineage 与取消进度事件。
- `AgentSessionRunCoordinator`：协调单轮 Loop 执行、终态 Session 提交、终态事件发布和记忆学习触发。
- `AgentSessionActiveRunController`：独占活动 run registry、取消/settlement、steer/follow-up 队列、run-owned resource 清理、关停和 orphan running snapshot 修复。
- `AgentSessionHistoryMutationCoordinator`：用 durable journal 协调 truncate/regenerate 的 Pi、Artifact、Memory 与 SQLite 变更，并在启动时恢复未完成 mutation。
- `AgentSessionForkCoordinator`：构造不可见候选快照，协调 Pi fork、Artifact owner retain 和最终 SQLite 发布；失败时执行确定性补偿。
- `AgentSessionCloseCoordinator`：收口活动 run，释放 Pi/会话资源和当前 Artifact owner；失败状态写入 metadata 供启动恢复。
- `AgentSessionPiManagementController`：集中 compact、export 等 Pi 管理操作的可用性检查和事件投影。
- `AgentSessionArtifactLifecycle`：Session 依赖的最小 Artifact owner 端口，避免导入具体 retention 实现。
- `AgentSessionRunProjection`：生成本轮 user entry、模型消息、step trace 和 conversation 合并结果。
- `AgentSessionRunSnapshotWriter`：统一写入 running、completed、cancelled、failed 和重启恢复快照。
- `AgentSessionHistoryReplay`：在固定高水位内把持久化 conversation、step trace、run snapshot 和 run event 逐页投影为历史回放事件。
- `AgentSessionHistoryPaging`：集中定义 repository 最大页尺寸和 replay 默认分页策略，拒绝无界或非法页尺寸。
- `AgentSessionTitleProjector`：优先从活动会话条目生成列表标题；持久化回退只读取 repository 的首条用户消息，不装载完整 conversation。
- `AgentSessionStore`：管理按需装载、容量受限的内存工作集，并通过仓储接口持久化会话与运行轨迹；服务启动不预载 conversation。
- `AgentSessionWorkingSetPolicy`：定义空闲 conversation 工作集容量；默认值集中在策略模块，测试或宿主可显式覆盖。
- `AgentSessionRepository`：组合 metadata、catalog、paged history 和显式 full-history 读端口，以及 mutation 写入契约；调用方应依赖最窄端口。
- `AgentSqliteSessionRepository`：SQLite 聚合仓储入口和 transaction boundary；拥有 Session metadata、durable mutation journal、command receipt、用户资料和数据库生命周期。
- `AgentSqliteSessionHistoryStore`：独占 conversation、step trace、run snapshot、turn preparation 和 run event 的 SQL、分页与行级编解码。
- `AgentSqliteSessionMapper` / `AgentSqliteSessionTraceStore`：SQLite row 到 session 的投影、标题恢复和 entry/trace 批量原子落盘。
- `AgentSessionEventFactory` / `AgentSessionEventTypes`：生成和描述会话层事件。

## 边界规则

- Session 可以调度 `Loop`，但不实现模型调用、工具执行或规划算法。
- 对话条目的结构与物化属于 `Conversation`。
- SQLite row、codec、schema、statement 仍由 `SessionPersistence` 管理，Session 只暴露仓储接口和实现入口。
- `AgentSessionManager` 是组合根和稳定 API facade，不重新实现 message、history 或 active-run 状态机。协作者只接收所需端口，禁止反向依赖 Manager。
- 活动 run 的可变 registry 只允许存在于 `AgentSessionActiveRunController`；`AgentSessionRunCoordinator` 不维护并行 Map、shutdown flag 或取消 settlement。
- SQLite transaction 由 `AgentSqliteSessionRepository` 发起；历史表 SQL 只允许进入 `AgentSqliteSessionHistoryStore` 或它组合的 trace store。HistoryStore 不提交 mutation journal，也不管理数据库连接生命周期。
- message、history replay、rename、truncate、regenerate、fork 和 close 必须经过 admission。fork 同时持有 source/target admission，锁顺序不能由调用方向决定。
- truncate 在任何 Pi、Memory 或 Artifact 副作用之前验证 request boundary。缺失 boundary 返回稳定 `session_history_boundary_missing`，不能退化为 reset 整个 Pi 会话。
- history mutation 先 stage journal，再执行 Pi rewind/reset 和 request-scoped cleanup，最后提交 SQLite。commit 失败必须保留 journal，供重启重放。
- fork 先 stage journal，再 fork Pi、追加目标 Artifact owner，最后原子发布目标 SQLite snapshot。最终 commit 前，列表、读取和事件订阅都看不到目标会话。
- close 与 truncate 只释放当前会话的 Artifact owner；共享 Artifact 仍有 owner 时不得删除。
- `AgentSessionManager` 只保留 API 编排；regeneration lineage 是会话 lifecycle metadata，不得回退到进程内 Map。需要复用的 turn preparation 仍在专用 repository 表中，replacement request 在提交前显式继承它。
- 面向用户的 Session catalog 只读取 metadata/count；启动恢复只走不聚合 conversation 的 metadata reader。`get/open` 首次访问某个持久化会话时才装载完整 conversation。空闲会话按 LRU 参与工作集淘汰，运行中会话和 admission 持有的会话不得淘汰；sequence 缓存必须随淘汰一并释放。禁止恢复启动期的全量 `hydrate/loadAll` 路径。
- 列表标题回退必须调用 `loadFirstUserMessage(sessionId)`；SQLite 使用 `kind + sequence + LIMIT 1` 的专用查询，内存实现提供相同 conformance 语义。禁止为标题调用 `loadEntries()`。
- request boundary、request event replay 和 fork 前缀必须走 `AgentSessionRepository` 的 request-scoped 契约。禁止以 `loadEntries/loadRunEvents` 后的 `find/filter/first match` 代替索引查询；fork 只物化 through-request 之前的产品历史。
- history replay 先捕获 entry sequence、step-trace row、run-snapshot revision 和 run-event ID 高水位，再使用稳定 keyset cursor 分页。run snapshot 在 revision 水位内解析每个 request 的最后版本，并按不可变 `history_sequence` 排序；回放期间的状态更新和新尾部都属于下一次 refresh。
- trace 页只批量读取该页 request IDs 对应的 conversation entries 和 lifecycle snapshots；snapshot-only runs 也逐页读取，并在捕获的 trace 高水位内判断是否已有 trace。禁止为投影构造全会话 entry index、snapshot Map 或逐 request 的 N+1 查询。
- `AgentSessionHistoryReplay` 只依赖分页历史端口，不能重新依赖 `loadEntries/loadStepTraces/loadRunSnapshots/loadRunEvents` 等完整读取方法。完整读取只用于显式的会话物化、维护流程和定向测试。
- wait recovery 只为当前 event 页中的 pending wait request 批量解析 terminal snapshot；跨页状态仅保留尚未解决的 wait，不保留全历史 terminal/resolved 集合。
- entry 解码失败不能阻塞 cursor；页游标由已消费的持久化 row 决定，而不是由成功解码的 item 数量决定。
- `session.history.steps` 是可重复发送的追加 chunk。客户端必须在 `session.history.completed` 前累积各 chunk，不能用后页覆盖前页。
