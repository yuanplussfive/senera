# Xml 模块

`Xml` 是 Agent 内部结构化协议的基础设施，负责 XML 协议定义、解析、诊断、Markdown 到 XML 的投影和工具结果 XML 渲染。

## 模块职责

- `AgentXmlPolicy` / `AgentXmlStatus`：定义 XML 协议、运行时字段规则、错误码和状态码。
- `AgentXmlParser` 及相关 scanner / validator：解析 XML、定位错误、验证结构和禁止语法。
- `AgentXmlParserTextLimits` / `AgentXmlDocumentValidator` / `AgentXmlNodeNormalizer`：XML parser 的文本预算、文档结构和节点归一化协作者。
- `AgentMarkdownPromptXmlRenderer` / `AgentMarkdownSections`：把提示词文档中的 Markdown 结构投影成 XML 上下文。
- `AgentToolResultXmlRenderer`：把工具结果渲染成历史上下文可复用的 XML observation。

## 边界规则

- Xml 只处理协议、解析、诊断和渲染，不决定下一步动作，也不执行工具。
- 新请求链路不再使用 XML 决定工具调用；XML 只作为内部上下文、文档和历史 observation 表达。
- 新增 XML 标签、错误码或协议字段时，先更新 `AgentXmlPolicy` 和验证脚本，再接入调用方。
