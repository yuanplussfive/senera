# Schemas 模块

`Schemas` 存放运行时配置和插件 manifest 的 Zod 校验契约。这里不做业务编排，只定义输入边界。

## 模块职责

- `AgentSystemConfigSchema.ts`：系统配置 schema 顶层装配。
- `Agent*ConfigSchema.ts`：按配置领域拆分的配置 schema。
- `PluginManifestSchema.ts`：插件 manifest schema 兼容出口。
- `PluginManifestTopLevelSchema.ts`：插件 manifest 顶层结构。
- `PluginManifestSharedSchema.ts`：插件 kind、entry、decision action、security、prompting 等共享结构。
- `PluginSearchManifestSchema.ts`：工具/技能/agent 搜索字段和 capability 结构。
- `PluginArtifactManifestSchema.ts`：工具 artifact policy、evidence、workspace capture 结构。
- `PluginToolManifestSchema.ts`：工具 manifest 结构。
- `PluginSkillManifestSchema.ts`：技能 manifest 结构。
- `PluginAgentManifestSchema.ts`：agent、context pack、workflow、merge policy 结构。
- `PluginRootCommandManifestSchema.ts`：root command 和 visible output 结构。

## 边界规则

- schema 文件只表达字段契约，不读取文件系统、数据库或插件目录。
- 对外导入优先使用 `PluginManifestSchema.ts` 和 `AgentSystemConfigSchema.ts` 兼容入口。
- 新增 manifest 子域时先增加对应 schema，再更新 `Types/PluginManifestTypes.ts` 和验证脚本。

