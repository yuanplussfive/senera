# 学习系统边界与诊断

Senera 不使用一个大模型调用同时生成长期记忆、工具路由和 Skill 文件。三个领域各自拥有证据和生命周期：

- `MemoryLearning` 从完成的会话 episode 提取跨会话耐久事实，先写 candidate，再经相似度、支持度和 write resolver 晋升长期记忆。
- Tool 路由学习只处理实际 ToolSearch 候选、已选工具和工具结果；模型只能从受限候选词与已声明 tags 中输出结构化路由记录。
- Skill 路由学习不生成或修改文件，只从可归因的成功执行确定性提取请求关键词，并绑定 accepted Skill revision。

## 可观测状态

Tool/Skill 路由先写 `learning_episodes` observation，再转为：

- `learned`：经验已进入聚合索引。
- `skipped`：没有可靠结果、没有匹配搜索候选、无法归因或没有可复用关键词。
- `failed`：模型、校验、分词或持久化处理失败。
- `observed`：已入队但异步 Tool 学习尚未完成。

原始任务结果和学习旁路隔离。学习失败记录 `routing.learning.observation_failed`、`tool.learning.failed` 或 `skill.learning.failed`，不能让已完成的 Agent turn 失败。

## Skill 选择算法

静态 `SKILL.md` 描述、use cases、capability facets 和推荐工具先由 MiniSearch 召回。历史成功项按关键词重合、时间半衰期、支持质量和 Bayesian confidence 形成附加 rank score。学习证据可以补召回或提升已有结果，但显式 `$skill-name` 永远优先。

每条 Skill term 包含 `projectId + skillName + skillRevision + term + source`。选择器只读取当前 revision；发布新 snapshot 会自然淘汰旧 revision，不需要清库或写迁移规则。

## 诊断

`LearningManage` 是只读 Bootstrap System Tool：

- `status`：按 domain/state 汇总 episode，并返回 Skill term 数量。
- `list`：读取指定数量的最近 episode。
- `inspect`：按 episode id 查看输入上下文、归因主体、结果和错误。
- `skill_terms`：查看指定数量的 Skill term，可按 skillName 过滤。

长期记忆 job 仍使用 Memory repository 的状态与日志诊断；不要把它写入 ToolSearch ledger，也不要让 `ToolLearning.Enabled` 控制 `MemoryLearning`。
