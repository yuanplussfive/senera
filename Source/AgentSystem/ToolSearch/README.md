# ToolSearch 模块导览

ToolSearch 模块负责工具发现、工具排序、工具使用记忆和工具学习。

## 阅读顺序

1. `AgentToolSearchRuntime.ts`：系统工具搜索入口，负责把请求转成候选工具集合。
2. `AgentToolSearchIndex.ts`：工具索引入口，负责构建文档并合并多路排序。
3. `AgentToolSearchDocumentBuilder.ts`：从插件契约、能力、标签和参数生成搜索文档。
4. `AgentToolSearchRankPipeline.ts` / `AgentToolSearchReranker.ts`：BM25、精确匹配、记忆信号和重排序融合。
5. `AgentToolSearchMemory.ts`：工具使用记忆入口，负责记录 episode、查询记忆证据和返回工具使用模式。
6. `AgentToolSearchMemoryTypes.ts` / `AgentToolSearchMemoryProjection.ts`：记忆契约和学习聚合算法。
7. `AgentToolSearchMemoryStore.ts`：存储兼容出口和数据库路径解析。
8. `AgentToolSearchSqliteMemoryStore.ts` / `AgentToolSearchInMemoryStore.ts`：SQLite 和内存存储实现。
9. `AgentToolSearchMemoryRows.ts` / `AgentToolSearchMemoryCodec.ts` / `AgentToolSearchMemorySqlSchema.ts` / `AgentToolSearchMemorySqlStatements.ts`：行类型、JSON 列编解码、schema 和 SQL statements。
10. `AgentToolSearchUsageMemory.ts`：把一次运行中的工具调用结果投影成可学习 episode。
11. `AgentToolLearningRuntime.ts` / `AgentToolLearningSchema.ts`：工具学习模型调用和结构化结果校验。
12. `AgentToolSearchToolProtocol.ts` / `AgentToolSearchResultProjector.ts`：系统工具参数和返回结果投影。

## 扩展规则

- 新增工具搜索策略时优先扩展 rank pipeline，不直接改 runtime。
- 工具学习只记录结构化 episode 和聚合结果，不写临时反馈概念。
- 搜索文档字段来自插件契约和 manifest，不在 runtime 里硬编码工具名单。
- 新增工具搜索行为优先扩展工具签名映射、Pi 工具桥接或插件 artifact 核心验证，避免新增零散专项脚本。
