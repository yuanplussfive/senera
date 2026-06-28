# Decision 模块

`Decision` 负责模型输出进入执行链路前后的决策处理，包括输出契约判断、XML 收集、解析、修复错误构造、决策执行和决策事件类型。

## 模块职责

- `AgentDecisionXmlCollector`：从模型流式输出中收集符合当前 root command 的结果。
- `AgentDecisionXmlStreamCollector` / `AgentDecisionXmlCollectionEvents` / `AgentDecisionXmlCollectionErrors`：分别负责模型流读取、收集事件和收集阶段可修复错误。
- `AgentDecisionXmlEnvelopeAnalyzer` / `AgentDecisionXmlEnvelopeTypes` / `AgentDecisionXmlFenceReader`：识别模型输出中的 XML envelope、候选根节点和 fenced XML。
- `AgentDecisionOutputResolver`：判断输出是工具调用、最终文本、混合输出还是未完成输出。
- `AgentDecisionParser`：把 XML 决策解析成结构化 `AgentDecision`。
- `AgentDecisionExecutor`：执行结构化决策中的工具调用或控制动作。
- `AgentDecisionToolResolver` / `AgentDecisionToolCallRunner` / `AgentDecisionToolControl` / `AgentDecisionToolEventEmitter`：分别负责工具可见性解析、单次工具调用、控制工具结果和执行事件。
- `AgentDecisionErrorFactory`：把解析、契约、工具和 schema 问题转成可修复诊断。
- `AgentDecisionRootSuggestions` / `AgentDecisionSchemaDiagnostics` / `AgentDecisionToolDiagnostics`：错误工厂使用的根标签建议、schema 诊断和工具诊断投影。
- `AgentDecisionExecutionCommandHandler`：把 Loop 状态机命令连接到决策执行。

## 边界规则

- Decision 可以使用 `Xml` 基础设施，但不定义 XML 协议本身。
- Decision 可以调用工具执行服务和插件注册表，但不拥有插件扫描、配置或 artifact 存储策略。
- Loop 只调度 Decision 命令，不直接解析模型 XML 或执行工具。
