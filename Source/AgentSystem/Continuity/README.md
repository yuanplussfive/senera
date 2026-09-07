# Continuity 模块导览

Continuity 将完成回合的物理来源建模为可追溯的学习记录、稳定画像、状态和条件规则。它不创建第二条模型对话，不生成 Markdown 记忆文件；事件索引投影宿主生成的短摘要和物理来源句柄，不把原始历史正文直接注入模型。

## 唯一记忆路径

1. Memory 保存 memory_episodes 与 memory_sources，作为用户消息和工具证据的物理来源。
2. AgentContinuityLearningRuntime 先运行事实阶段；模型调用 `ContinuityCapture({ items, agenda, needsRulePass })`。每个 item 只表达一个浅层的 fact、profile、agent_profile 或 relation，模型不输出 URI、证据、scope、置信度、时间或图身份；宿主补齐来源、版本和生命周期。`agent_profile` 只接受直接证据，写入 Resident 的 world scope，与用户画像严格分栏。
3. 事实立即写入 `continuity_observations(kind=learning.record)`；画像写入版本化 profile；关系写入 SQLite 属性图。不因后续条件建模失败而回滚；显式 `MemoryWriteTool` 证据中的有效期由宿主解析，不要求模型重复输出。
4. 仅当 `needsRulePass=true` 时运行建模阶段；`true` 是强契约，结果必须包含一个非空 `items` 列表，每项用 `kind` 表示 state、always、conditional 或 notify。无效响应只记录为当前阶段失败，不切换请求协议；任务策略只允许在同一已选协议上重新尝试。
5. 建模阶段按方法输出键值对象。模型使用自然语言状态或复用宿主提供的 `senera://continuity-state/...`；同一规则通过 `target` 引用 `ruleCatalog`，明确纠正时再使用 `replace=true`。宿主负责身份、来源、权威、置信度、scope、时间、条件 AST 和合并决策。
6. 规则采用“不可变证据 + 唯一物化头”：条件先规范化，等价动作只强化同一规则；每个 episode 只计一份独立证据，重复证据不会提高权威等级。纠正会建立新头并把旧头标记为 superseded，历史和物理来源继续保留。

## 属性图

- `AgentContinuityRelationCatalog` 是唯一关系词表。模型只能复制其中的关系 ID；关系标签和别名只服务于本地检索与展示，不能宽松地写回结构化学习结果。
- SQLite 是图的唯一权威存储：实体、别名、边、边证据、时间窗口、权威、支持度、成熟度与 supersession 都在同一条持久化路径上维护。前端不保留第二份可写图。
- `single_subject` 关系按权威、成熟度、最近物理证据、支持度和置信度仲裁；低权威的相反候选会保留可追溯证据，但不能覆盖用户明确事实。
- `candidate` 关系可在连续性面板中核验，却不会进入主提示词或驱动图扩展；只有 active/established 边能参与一跳关联召回。
- 侧栏的关系图只是当前快照的有界投影：优先展示本轮已注入关系和直接锚点，随后按成熟度、支持度与时效排序。它使用懒加载的 React Flow/Dagre，不额外请求模型，也不改变 SQLite 图。

## 召回与注入

- AgentContinuityRecordRanker 检索 fact 学习记录和物理 episode/source 事件，融合 BM25、中文 token、文本相似度、模糊匹配、权威、置信度、scope 和时效；默认不调用向量或重排模型。索引和查询缓存按目录 revision、TTL 与 LRU 复用，空查询不会建立索引快照。
- 本地召回采用有界级联：先执行原始查询，再仅在结果缺失或歧义时尝试会话上下文与一轮伪相关反馈。候选阶段必须保留基线的直接证据、分数和首位，近失配只用于诊断，不能制造“改进”。反馈的词项统计统一覆盖学习事实和物理事件，并按 URI 去重。
- 关系检索先由本地 MiniSearch/Jieba/模糊匹配生成 query plan，再在已确认实体上执行至多一跳扩展；直接命中的关系 ID 优先于泛化邻边。图扩展只拓宽候选，不会直接断言事实或触发通知。
- Recall 生命周期采用轻量分层策略：配置中的 TurnValueClassifier 只在本地分类器对回合价值做出高置信度判断后跳过文本事实/事件检索，画像、Goal、信号和规则评估仍然执行；索引由按 scope 的数据库 revision 和 TTL 控制复用。
- resident profile 只包含稳定画像键值，但作为最新 `senera.turn_context` 的可变快照渲染；画像更新不会重建人格与执行内核的稳定前缀。
- 事实学习动态目录同时提供 `profileCatalog`（用户）和 `agentProfileCatalog`（Resident），模型可复用同一主体的精确键来更新画像，避免自我演化产生重复键或把用户偏好写到 Resident 身上。
- 会话内对话示例由本地来源索引按相关度选择，不调用模型；示例只作为带边界的引用风格资料，复用事件槽位与字符预算，永不替代事实或规则证据。
- 完成回合后，AgentMemoryService 通过微任务调用连续性预取，只预热本地确定性索引，不调用模型、不写入 ledger，也不阻塞已完成回合的提交；预取目录与正式请求共享同一 scope 快照。物理 episode 检索直接读取 memory_episodes/memory_sources，学习门控跳过或延迟时仍可按引用召回。
- 高阈值命中注入摘要；运行时上下文仍保留物理来源 URI 和 watermark，精确证据由 MemoryRecallTool 解引用。
- 普通学习记录命中仍只注入 senera://memory-source/... 引用；模型需要精确证据时通过 MemoryRecallTool 解引用。
- 事件命中注入宿主生成的摘要和来源 URI。摘要用于恢复上下文，原文和完整证据仍通过 MemoryRecallTool 按需读取。
- 物理来源只把已持久化的正文或摘要作为语义证据；工具名、来源类别和 URI 仅是身份/可追溯元数据，不会伪装成可召回内容。没有任何正文的来源不会进入事件召回或时间摘要。
- 事实重写沿用宿主拥有的稳定 key：本地身份比较允许省略会话主语和真实同义改写，却显式拒绝不同主体、否定、数值/日期冲突和有序参数互换；Jieba 的分词差异会在比较前按 POS 结构恢复，不依赖名字或领域词表。
- 无关记录在权威、置信度和时效参与排序前被过滤。
- state 通过当前状态投影；candidate rule 可在连续性面板核验，但只有 active/established rule 在部分满足或触发时进入主提示词。模型不可创建 `namespace.key` 技术标识。
- 一次性 rule 的条件评估不等于送达；只有包含该 rule 的回合成功持久化后才确认消费，失败或取消的回合会在后续请求重试。

## 学习阶段

- Facts 当前按完成 episode 独立执行；`facts=[]` 是合法结果，物理 episode 与 source 仍然保留。普通 episode 会先经过 session idle debounce，连续对话时尚未 claim 的 pending facts 会整体顺延；立即证据不顺延。
- profile 记录按作用域和键版本化；同一键只有一个 active 版本，旧版本保留为 superseded，过期版本不进入新回合。
- Modeling 按需执行，并接收宿主提供的 stateCatalog 与 ruleCatalog。目录键是稳定 Senera URI，模型只能复制已有 URI；`target` 强化已有规则，`target + replace=true` 表达有来源支撑的纠正，新的自然语言状态和规则身份由宿主分配。
- 每个阶段只使用所选模型的 `ToolPlanningMode`：`native` 走 Pi 原生工具调用，`baml` 走 BAML 结构化请求。协议失败不会自动切换到另一条链路；两种链路都不发送输出 token 上限。
- native 与 BAML 共用 `AgentContinuityLearningPromptBundle` 的稳定语义合同。捕获策略、关系注册表和宿主验收样例位于冻结前缀；当前 episode、指代上下文、相关画像与 Agenda 位于动态 user payload，关系表不在每轮重复发送。
- `AgentContinuityLearningContextSelector` 使用现有本地分词、文本相似度和一个共享字符预算选择动态画像/Agenda 目录；不使用固定条数、短句种子表或额外模型请求。
- 每个 prompt bundle 在进程内按 stage、合同 revision 和样例预算冻结。只有经过 schema 解析、宿主编译并进入正式写入路径的结果才写入 `continuity_learning_inferences`；代表样例要到新进程的新 bundle 才能进入稳定前缀，不能逐轮改写缓存边界。
- 可选 `AgentInferenceBudgetPort` 只在学习推理缓存未命中时消耗请求/估算输入 token 额度；拒绝会带精确 `retryAt` 回到持久化重试队列，不删除已记录回合。预算由宿主注入，默认不改变前台回合调用。
- 完全相同的输入按合同 revision、provider、model 和协议生成精确指纹，重试直接复用已验收结果；不同 episode 仍调用模型，但通过哈希化的稳定 cache scope 和 `cacheRetention=long` 复用 Pi 的供应商提示缓存。`continuity.learning.model_usage` 记录 provider 报告的 cache read/write token。
- 规则阶段失败只重试规则；事实阶段不会被重复调用或覆盖。
- 连续性学习配置集中在 ContinuityLearning：LearningGate.DeferredDelaySeconds 控制普通回合的空闲延迟，Recall.TurnValueClassifier 控制基于真实学习结果训练的本地回合价值分类器，Recall.Prefetch 控制索引预取与 TTL；运行时解析模型配置，表单投影不触发供应商解析。
- 阶段完成与对应记录在同一 SQLite 事务内提交；未 claim 的阶段不能写入结果或失败状态。
- 进程启动时会把中断的 `running` 阶段恢复为可重试状态，并从 `facts_json` 继续规则阶段。
- 用户消息保留原话；工具和 assistant 事件优先使用宿主摘要，避免把冗长结果重复送入两个学习阶段。

## 工具边界

- MemoryWriteTool 只产生明确记忆意图及其有效期的物理工具证据；完成回合学习器负责持久化，工具不建立第二套写入表。
- MemoryRecallTool 同时检索 learning.record 和物理 episode/source 事件；命中后仍只通过 senera://memory-source/... 解引用正文，不把整段历史自动塞进提示词。
- 不要重新引入旧版 assertion 候选池、向量记忆、worldbook 或 MEMORY.md 分支。规则 maturity 是规范头的证据状态，不是第二套待晋升记录。
