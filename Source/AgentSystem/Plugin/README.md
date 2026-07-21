# Plugin 模块

`Plugin` 负责外部插件和系统插件的配置读取、扫描、排序、注册与运行时契约投影。

## 模块职责

- `AgentPluginScanner`：根据系统配置发现插件并读取插件配置；用户插件首次扫描时会从 example 或最小默认值初始化可编辑的 `PluginConfig.toml`，系统插件目录保持只读。
- `AgentPluginConfig` / `AgentPluginConfigManager`：插件配置公共 API 和配置更新入口。
- `AgentPluginConfigSchema`：插件配置 schema 的结构定义和 schema TOML 解析。
- `AgentPluginConfigDocument`：配置文件路径、默认 TOML、TOML 路径读写和 strict path 辅助。
- `AgentPluginConfigFormProjector`：把 schema 投影为前端配置表单字段，并校验字段值。
- `AgentPluginConfigRuntime`：插件可用性、系统插件默认策略、工具启用状态和 snapshot 投影。
- `AgentPluginRegistry`：维护已加载插件、工具、技能、工作流和决策动作。
- `AgentPluginRuntimeContractProjector`：把插件声明转换成运行时可执行契约。
- `ToolContracts`：加载、校验并冻结插件的版本化静态工具契约；契约缺失、越界或与 manifest 不一致时拒绝注册。
- `AgentPluginOrdering`：提供稳定的插件排序规则，保证 prompt 和 UI 展示一致。

## 边界规则

- Plugin 只负责注册和契约投影，不直接执行工具进程。
- 工具执行属于 `ToolRuntime`，工具搜索和学习属于 `ToolSearch`。
- 新增插件字段必须先进入配置 schema 和运行时契约，再接入 UI 或 prompt。
- 声明工具的插件必须提供 `Contracts.File`，生产运行时不得从 TypeScript 源码动态生成契约。
- 排序、启用状态和配置投影保持确定性，避免调用点各自实现筛选规则。
