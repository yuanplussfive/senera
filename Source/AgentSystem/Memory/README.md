# Memory 模块导览

Memory 模块负责长期记忆的来源记录、候选生成、合并晋升、主动写入和回忆检索。

`MemoryLearning` 拥有独立的 `Enabled`、`Client` 和 repair 配置，不受 `ToolLearning.Enabled` 控制。空模型响应会按 provider 网络重试策略重试；最终失败进入 memory learning job 的 retry/failed 状态，不会伪装成“没有候选”。

## 阅读顺序

1. `AgentMemoryService.ts`：会话完成后写入原始记忆来源，并把可学习回合送入学习队列。
2. `AgentMemoryLearningRuntime.ts`：自动学习入口，编排候选记录、吸收已有记忆和晋升流程。
3. `AgentMemoryLearningPromptProjector.ts`：把 recorded turn、source catalog、候选和现有记忆投影成 BAML 学习输入。
4. `AgentMemoryLearningModelClient.ts`：封装 LearnMemory / ConsolidateMemoryCandidates 的结构化校验和 repair。
5. `AgentMemoryLearningVectorRuntime.ts`：候选 embedding、相似候选聚类、rerank 和长期记忆向量写入。
6. `AgentMemoryWriteRuntime.ts` / `AgentMemoryWriteResolver.ts`：主动写入入口，负责把工具写入请求解析成长期记忆变更。
7. `AgentMemoryRecallRuntime.ts`：系统回忆工具入口，负责参数校验和召回流程编排。
8. `AgentMemoryRecallTypes.ts` / `AgentMemoryRecallRanker.ts` / `AgentMemoryConversationRecall.ts` / `AgentMemoryRecallProjector.ts`：回忆工具的参数契约、长期记忆排序、普通对话降级检索和结果投影。
9. `AgentArtifactMemoryRuntime.ts`：artifact 资源读取入口，只负责 host tool 参数校验、配置解析和错误封装，不承担长期记忆召回。
10. `AgentArtifactMemoryTypes.ts` / `AgentArtifactManifestIndex.ts` / `AgentArtifactMemoryReader.ts` / `AgentArtifactMemoryProjection.ts` / `AgentArtifactJsonQuery.ts`：artifact 读取契约、capability 驱动的 manifest 索引、文本 ref 分页、JSON 结构索引续页、typed query 和模型安全投影。每个可读 ref 必须先通过 manifest 的 SHA-256 receipt 校验，文本、JSON、workspace patch 走同一验证路径。根 JSON index 从发布时生成的 NDJSON sidecar 按字节游标读取完整字段记录；`jsonView.index.sourcePath` 会流式重建指定嵌套对象的结构索引，游标同时绑定源、路径、明确标记的 sidecar 内容或派生路径索引身份与投影策略。query 使用受控 AST 流式读取原始 JSON，并按当前模型 token 预算返回完整元素。两类 cursor 不能混用，也不做整文件解析或字符串中段截断。
11. `AgentMemorySourceRecords.ts`：从完成回合的用户消息、最终回答和 `executedTools[].artifact` 直接构造 source；不读取 Conversation 中的证据副本。
12. `AgentMemorySourceRepository.ts`：记忆来源、候选和长期记忆的领域记录与仓储接口。
13. `AgentMemorySqliteSourceRepository.ts`：SQLite 仓储实现和事务编排。
14. `AgentMemorySqlStatements.ts`：SQL statements 兼容出口，按表族聚合 statement 模块。
15. `AgentMemoryEpisodeSqlStatements.ts` / `AgentMemorySourceSqlStatements.ts` / `AgentMemoryCandidateSqlStatements.ts` / `AgentMemoryItemSqlStatements.ts` / `AgentMemoryObservationSqlStatements.ts` / `AgentMemoryVectorSqlStatements.ts`：按表族拆分的 SQL statements。
16. `AgentMemoryVectorIndex.ts`：候选和记忆的向量相似度辅助。
17. `AgentMemoryRecordFactory.ts`：领域记录构造兼容出口。
18. `AgentMemoryEpisodeRecords.ts` / `AgentMemoryItemRecords.ts` / `AgentMemoryCandidateRecords.ts`：按 episode、item / observation、candidate / direct-write 拆分的领域记录构造。
19. `AgentMemoryRowMapper.ts`：领域记录和数据库行之间转换的兼容出口。
20. `AgentMemoryRowEncoders` / `AgentMemoryRowDecoders` / `AgentMemoryRowJson`：数据库写入投影、数据库读取投影和 JSON 边界解析。

## 扩展规则

- 新增记忆类型时先改 schema 和对应 record 构造模块，再改 runtime。
- 记忆必须能追溯到 source refs，不直接依赖临时上下文字符串。
- 工具来源以 Artifact URI、evidence URI 和 call ID 建索引；完整工具结果仍由 Artifact 服务读取，不复制到 Memory。
- 自动学习先写候选，满足支持度和相似度后再晋升。
- 主动写入可以直接生成长期记忆，但也要走统一记录格式。
- 删除或截断会话只清理 episode、source、candidate、learning job 和由这些 episode 产生的 observation；已经晋升的长期 memory item 及其 vector 具有独立生命周期，不随来源会话级联删除。
- 记忆领域新增运行时应放在本目录；`AgentSystem` 根目录只保留跨领域编排。
- 新增记忆行为优先扩展 runtime services、artifact policy 或配置服务核心验证，只有出现新的独立边界时才新增专项脚本。
