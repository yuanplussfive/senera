# Defaults 模块导览

`Defaults` 负责系统默认配置、配置合并和按领域读取默认值。运行时不应直接散落默认字面量。

## 阅读顺序

1. `AgentDefaultValues`：兼容出口，导出 `AgentDefaults` 和默认值类型。
2. `AgentDefaultCatalog`：静态默认配置目录。
3. `AgentDefaultValueTypes`：默认值解析后的结构类型。
4. `AgentDefaultResolver`：把用户配置与默认值合并成 resolved defaults。
5. `AgentModelProviderDefaults` / `AgentPlannerDefaults` / `AgentToolDefaults` / `AgentAppDefaults`：按运行域读取 resolved 配置。

## 边界规则

- 新默认值先进入 `AgentDefaultCatalog`，再由 resolver 暴露给运行时。
- 业务模块通过 resolver 或领域 helper 读取默认值，不直接复制默认字面量。
- 默认值类型和配置 schema 要同步维护，避免 UI、JSON 和运行时产生不同规则。
