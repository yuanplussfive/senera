# Xml 模块

`Xml` 是 Agent 内部结构化协议的基础设施，负责 XML 协议定义、解析、诊断、Markdown 到 XML 的投影、工具调用 XML 归一化和工具结果 XML 渲染。

## 模块职责

- `AgentXmlPolicy` / `AgentXmlStatus`：定义 XML 协议、运行时字段规则、错误码和状态码。
- `AgentXmlParser` 及相关 scanner / validator：解析 XML、定位错误、验证结构和禁止语法。
- `AgentXmlParserTextLimits` / `AgentXmlDocumentValidator` / `AgentXmlNodeNormalizer`：XML parser 的文本预算、文档结构和节点归一化协作者。
- `AgentMarkdownPromptXmlRenderer` / `AgentMarkdownSections`：把提示词文档中的 Markdown 结构投影成 XML 上下文。
- `AgentToolCallsXmlNormalizer`：把模型输出中的工具调用 XML 规范化到当前工具契约。
- `AgentToolCallsXmlDom` / `AgentToolCallsXmlLeafRules` / `AgentToolCallsXmlCdataReplacement`：工具调用 XML 归一化的 DOM 查询、契约 leaf 规则读取和 CDATA replacement。
- `AgentToolCallPlanXmlRenderer` / `AgentToolResultXmlRenderer`：把规划结果和工具结果渲染成统一 XML。

## 边界规则

- Xml 只处理协议、解析、诊断和渲染，不决定下一步动作，也不执行工具。
- Decision 阶段可以使用 Xml，但决策状态机、模型输出收集和修复逻辑应放在 Decision 领域。
- 新增 XML 标签、错误码或协议字段时，先更新 `AgentXmlPolicy` 和验证脚本，再接入调用方。
