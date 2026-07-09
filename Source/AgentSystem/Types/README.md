# Types 模块导览

`Types` 只放跨模块共享的结构契约，不放运行时逻辑、解析逻辑或默认值。

## 阅读顺序

1. `AgentSystemConfigTypes`：系统主配置聚合出口。
2. `AgentModelConfigTypes` / `AgentPlannerConfigTypes` / `AgentRuntimeConfigTypes`：按配置领域拆分的系统配置契约。
3. `PluginManifestTypes`：插件 manifest 的统一兼容出口，只保留顶层 manifest 组合。
4. `PluginManifestSharedTypes` / `PluginToolManifestTypes` / `PluginArtifactManifestTypes` / `PluginSearchManifestTypes`：插件基础、工具、artifact 和搜索相关 manifest 契约。
5. `PluginSkillManifestTypes` / `PluginRootCommandManifestTypes`：技能和 root command 契约。
6. `PluginRuntimeTypes` / `ToolRuntimeTypes`：插件加载后的运行时形态。

## 边界规则

- 外部模块优先从聚合出口导入：`PluginManifestTypes`、`AgentConfigTypes`、`PluginRuntimeTypes`、`ToolRuntimeTypes`。
- 新增 manifest 子域时，类型文件和 `Schemas/Plugin*ManifestSchema` 要按同一领域命名。
- 类型文件不要读取文件、访问数据库、组装默认配置或做 schema 校验。
- 只在确实需要跨领域组合时使用聚合文件，避免把所有子类型重新堆回单个文件。
