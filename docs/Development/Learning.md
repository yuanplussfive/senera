# 学习系统边界与诊断

Senera 不使用一个大模型调用同时生成长期记忆、工具路由和 Skill 文件。三个领域各自拥有证据和生命周期：

- 连续性学习从完成的会话 episode 写入不可变 Observation。事实阶段只输出 `facts + needsRulePass` 并立即持久化；按需建模阶段通过 states、always、conditional、notify 键值方法输出语义。已有状态使用 `senera://continuity-state/...` 引用，新状态由宿主分配身份。程序负责来源校验、幂等、作用域、置信度、条件 AST 和确定性求值；没有候选晋升或向量依赖。
- Tool 路由学习只处理实际 ToolSearch 候选、已选工具和工具结果；模型只能从受限候选词与已声明 tags 中输出结构化路由记录。
- Skill 路由学习不生成或修改文件，只从可归因的成功执行确定性提取请求关键词，并绑定 accepted Skill revision。

连续性学习采用“稳定画像 + 可检索事件”分层：resident profile 保存跨会话稳定画像，Continuity ledger 保存事实当前头、事实历史、规则和运行时信号，原始 episode 只作为可追溯来源。模型不负责事实身份、版本或证据编号；这些由宿主根据来源和确定性身份完成。

学习请求同样按稳定/动态边界拆分。稳定 `LearningPromptBundle` 包含版本化语义合同、关系注册表和在宿主侧成功编译的代表样例，并在进程内冻结；动态 payload 只包含当前物理 episode、指代上下文，以及本地相似度在共享字符预算内选出的相关画像和 Agenda。native/BAML 都经 Pi 使用同一哈希化 cache scope；模型原始输出只有通过 schema 和宿主编译后才可进入精确推理缓存或下一进程的示例候选，失败输出不得用于训练前缀。

完成回合后先持久化 episode，再执行 `ContinuityLearning.LearningGate`。门控按证据价值分为三种路径：显式记忆和真实工具/产物证据立即学习；普通回合进入 `DeferredDelaySeconds` 指定的空闲窗口，同一 session 的新普通回合会重置尚未开始的 pending facts，只有连续空闲到窗口结束才执行；可配置的确认语句只保留物理 episode，不启动模型提取。会话压缩前会释放所有尚未开始的延迟 job 并刷新学习，确保稳定事实先落账，再交给 Pi 压缩上下文。

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

连续性学习 job 分别保存 facts/rules 阶段状态、尝试次数和安全错误。规则失败不得回滚或重跑已成功事实；不要把它写入 ToolSearch ledger，也不要让 `ToolLearning.Enabled` 控制 `ContinuityLearning`。

每个阶段必须先原子 claim 才能提交结果或记录失败。服务重启会将中断的 `running` 阶段恢复到 retry 队列；已完成 facts 从 job 的 `facts_json` 恢复，规则阶段不重新请求 facts 模型。
