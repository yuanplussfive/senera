# Memory 模块导览

Memory 保存完成回合的物理历史，Temporal Memory 把物理历史增量概括为片段、日、月三级可追溯摘要，Continuity 负责建立语义记录，Resident Profile 保存少量稳定的人格/用户画像版本。它们共用一个数据库合同，但职责不同，不是重复记忆系统。Resident Profile 进入 stable prompt tier；当前事实、相关事件摘要和条件状态按当前回合进入 volatile tier。时间摘要只在按范围召回时进入工具结果。

## 阅读顺序

1. AgentMemoryService.ts：完成回合后保存来源，并将回合交给连续性学习队列。
2. AgentMemorySourceRecords.ts：从用户消息、最终回答和成功工具证据构造可追溯 source；`AgentMemorySourceText.ts` 是跨连续性、时间摘要和语义索引读取真实正文的唯一入口，工具名和 source kind 只保留为元数据。
3. AgentMemorySqliteSourceRepository.ts：持久化 episode/source，并按 URI 解引用。
4. TemporalMemory/AgentTemporalMemoryRuntime.ts：用独立结构化模型判断相邻完成回合的语义边界，按语义或日历边界封存片段，并在周期闭合后生成日/月摘要。
5. TemporalMemory/AgentTemporalMemoryRecall.ts：按时间范围选择最大完整摘要桶，并沿 source refs 逐层下钻。
6. Continuity/AgentContinuityLearningRuntime.ts：按所选模型协议运行抽取；失败只记录当前阶段诊断，不跨协议切换。
7. Continuity/AgentContinuityCandidateCompiler.ts：自动建立物理证据、状态和规则。
8. Continuity/AgentContinuityMemoryService.ts：执行统一排名与条件投影。
9. Continuity/AgentContinuityToolRuntime.ts：提供唯一的显式写入意图和召回入口。
10. Profile/AgentResidentProfileService.ts：把稳定画像从普通回合记忆中分离，并作为小型稳定上下文注入。

## 数据边界

- memory_episodes 与 memory_sources 保存物理历史，不自动进入提示词。episode 的 `assistantPreview` 只是最终回复预览，不是摘要。
- memory_temporal_digests 与 memory_temporal_digest_members 构成 `segment -> day -> month` 摘要 DAG；每层只引用直接子层，原始 episode/source 始终可追溯。
- memory_temporal_segment_decisions 是按会话有序执行的持久化边界队列；失败会按正式作业策略重试，前序未决时不会越序切分后续回合。
- 开放片段只保留一条非事实性的 `working_focus` 供下一轮边界判断，并携带最近完整回合而不是反复发送整个片段；封存时该工作状态会被清空，最终摘要仍从全部物理成员生成。
- 完整月份优先月摘要，不完整月边界使用日摘要，未闭合当天使用片段摘要；未被摘要覆盖的最新 episode 才直接读取物理来源。
- World 只接收已封存片段作为当天对话事件；日/月摘要属于记忆索引，不重复写入世界状态。
- continuity_observations(kind=learning.record) 保存唯一的归一化学习记录。
- learning.record 的 session/截止时间来自 MemoryWriteTool 物理证据并由宿主关联；普通学习事实默认长期有效。
- continuity_signals 和 continuity_rules 保存宿主编译的状态与条件。
- resident_profile_records 保存画像键值的版本历史；同一作用域和键只有一个 active 版本，旧版本保留为 superseded。
- 旧候选、向量、断言、晋升和 migration 辅助表已由 schema v7 删除。
- 删除会话时清理 session scope 的来源、学习记录、signal 和 rule；workspace 等长期 scope 保留。
- 记忆必须追溯到 source refs；模型不输出证据索引、权威、置信度、数据库 ID 或 AST。
