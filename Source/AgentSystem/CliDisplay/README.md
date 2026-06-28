# CliDisplay 模块

`CliDisplay` 负责命令行事件展示，包括活动时间线、颜色主题、树形结构输出和长文本预览。

## 模块职责

- `AgentCliActivity`：定义 CLI 活动视图、分组、补丁和细节模式。
- `AgentCliActivityProjector`：组合各类事件 projector，提供 CLI 活动投影入口。
- `AgentCliLifecycleActivityProjectors`：会话和 run 生命周期事件展示。
- `AgentCliDecisionActivityProjectors`：prompt、model、decision 和 XML 事件展示。
- `AgentCliToolActivityProjectors`：工具调用、重试、最终回答和追问事件展示。
- `AgentCliActivityProjectorUtils`：活动补丁、step 分组、摘要格式化和详情开关等公共展示工具。
- `AgentCliTimelineRenderer`：把活动状态渲染成终端可显示的多行文本。
- `AgentEventDisplayCatalog`：compact / verbose 事件展示入口。
- `AgentEventCompactDisplayCatalog` / `AgentEventDisplayMessages` / `AgentEventDisplayTokens`：compact 事件映射、事件消息表和 token 格式化。
- `AgentEventDisplayValueReaders` / `AgentEventDisplayTypes`：事件展示值读取和公共类型。
- `AgentCliPreviewFormatter`：按模型 token 预算压缩长文本和结构化值。
- `AgentConsoleTheme` / `AgentConsoleTreeFormatter`：统一终端配色和结构化对象展示。

## 边界规则

- CliDisplay 只做展示投影，不改变事件语义和运行状态。
- CLI 命令解析仍在 `Apps/Cli.ts`，这里不处理 WebSocket、会话或配置读取。
- 新增事件展示时优先扩展 projector 和 renderer，避免在 CLI 入口里堆分支。
- 颜色和图标集中在展示模块维护，其他模块只提供结构化事件。
