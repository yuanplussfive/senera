# Prompt 模块

`Prompt` 负责把运行时已有的结构化上下文投影成模型可读提示词，包括工具契约、决策动作契约、技能、工作流、root command 和角色预设。

## 模块职责

- `AgentPromptContextBuilder`：从插件注册表、系统配置、技能匹配和角色预设构建统一 prompt context。
- `AgentPromptContextTypes` / `AgentPromptSectionResolver`：集中定义 prompt context 契约和 markdown section 解析规则。
- `AgentPromptDocumentationReader`：读取插件/技能 markdown，并统一转换为提示词 XML。
- `AgentPromptToolContextProjector` / `AgentPromptSkillContextProjector`：把工具、决策动作和技能投影成模型可读上下文。
- `AgentPromptContractTypes`：定义模型可读 TS/XML 预览与 JSON Schema 的统一契约视图。
- 开发期契约生成位于 `Build/GenerateToolContractBundles`；生产运行时只消费经过校验的静态契约包。
- `AgentPromptRenderer`：把结构化片段渲染为最终提示词文本。

## 边界规则

- Prompt 不扫描插件目录，只消费 `Plugin` 已注册的工具、技能和决策动作。
- Prompt 不解析 TypeScript，也不生成 JSON Schema；这些工作属于开发期契约构建。
- Prompt 不执行模型请求；模型调用属于 `ActionPlanner`、记忆学习或具体运行时客户端。
- Prompt 不解析模型输出；输出解析和 repair 属于对应决策或 planner 模块。
- 新增提示词输入时优先扩展结构化 context，再由 renderer 统一渲染，避免在调用点拼接零散字符串。
