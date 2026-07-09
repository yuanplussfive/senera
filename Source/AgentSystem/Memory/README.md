# Memory 模块导览

Memory 模块负责长期记忆的来源记录、候选生成、合并晋升、主动写入和回忆检索。

## 阅读顺序

1. `AgentMemoryService.ts`：会话完成后写入原始记忆来源，并把可学习回合送入学习队列。
2. `AgentMemoryLearningRuntime.ts`：自动学习入口，编排候选记录、吸收已有记忆和晋升流程。
3. `AgentMemoryLearningPromptProjector.ts`：把 recorded turn、source catalog、候选和现有记忆投影成 BAML 学习输入。
4. `AgentMemoryLearningModelClient.ts`：封装 LearnMemory / ConsolidateMemoryCandidates 的结构化校验和 repair。
5. `AgentMemoryLearningVectorRuntime.ts`：候选 embedding、相似候选聚类、rerank 和长期记忆向量写入。
6. `AgentMemoryWriteRuntime.ts` / `AgentMemoryWriteResolver.ts`：主动写入入口，负责把工具写入请求解析成长期记忆变更。
7. `AgentMemoryRecallRuntime.ts`：系统回忆工具入口，负责参数校验和召回流程编排。
8. `AgentMemoryRecallTypes.ts` / `AgentMemoryRecallRanker.ts` / `AgentMemoryConversationRecall.ts` / `AgentMemoryRecallProjector.ts`：回忆工具的参数契约、长期记忆排序、普通对话降级检索和结果投影。
9. `AgentArtifactMemoryRuntime.ts`：artifact 记忆读取工具入口，只负责 host tool 参数校验、配置解析和错误封装。
10. `AgentArtifactMemoryTypes.ts` / `AgentArtifactManifestIndex.ts` / `AgentArtifactMemoryReader.ts` / `AgentArtifactMemoryProjection.ts`：artifact 读取的参数契约、manifest 索引、ref 文件读取和模型安全投影。
11. `AgentPlannerMemory.ts`：规划器短期记忆投影，负责 planner journal、state snapshot 和 tool evidence memory。
12. `AgentMemorySourceRepository.ts`：记忆来源、候选和长期记忆的领域记录与仓储接口。
13. `AgentMemorySqliteSourceRepository.ts`：SQLite 仓储实现和事务编排。
14. `AgentMemorySqlStatements.ts`：SQL statements 兼容出口，按表族聚合 statement 模块。
15. `AgentMemoryEpisodeSqlStatements.ts` / `AgentMemorySourceSqlStatements.ts` / `AgentMemoryCandidateSqlStatements.ts` / `AgentMemoryItemSqlStatements.ts` / `AgentMemoryObservationSqlStatements.ts` / `AgentMemoryVectorSqlStatements.ts`：按表族拆分的 SQL statements。
16. `AgentMemoryVectorIndex.ts`：候选和记忆的向量相似度辅助。
17. `AgentMemoryRecordFactory.ts`：领域记录构造兼容出口。
18. `AgentMemoryEpisodeRecords.ts` / `AgentMemorySourceRecords.ts` / `AgentMemoryItemRecords.ts` / `AgentMemoryCandidateRecords.ts`：按 episode、source、item / observation、candidate / direct-write 拆分的领域记录构造。
19. `AgentMemoryRowMapper.ts`：领域记录和数据库行之间转换的兼容出口。
20. `AgentMemoryRowEncoders` / `AgentMemoryRowDecoders` / `AgentMemoryRowJson`：数据库写入投影、数据库读取投影和 JSON 边界解析。

## 扩展规则

- 新增记忆类型时先改 schema 和对应 record 构造模块，再改 runtime。
- 记忆必须能追溯到 source refs，不直接依赖临时上下文字符串。
- 自动学习先写候选，满足支持度和相似度后再晋升。
- 主动写入可以直接生成长期记忆，但也要走统一记录格式。
- 记忆领域新增运行时应放在本目录；`AgentSystem` 根目录只保留跨领域编排。
- 新增记忆行为优先扩展 runtime services、artifact policy 或配置服务核心验证，只有出现新的独立边界时才新增专项脚本。
