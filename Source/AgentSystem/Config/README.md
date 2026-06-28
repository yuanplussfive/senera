# Config 模块导览

Config 模块负责配置的读取、数据库镜像、表单投影和模型列表发现。

## 阅读顺序

1. `AgentConfigService.ts`：配置服务入口，负责 JSON 和 SQLite source 的统一快照。
2. `AgentConfigServicePaths` / `AgentConfigDiagnostics`：配置路径、JSON 镜像写入和诊断格式化。
3. `AgentConfigSqliteRepository.ts`：配置数据库持久化。
4. `AgentConfigFormProjector.ts`：配置表单投影入口。
5. `AgentConfigFormDocument.ts` / `AgentConfigFormFieldProjector.ts` / `AgentConfigEffectiveProjector.ts`：表单说明文件校验、字段投影和 effective 配置投影。
6. `AgentProviderModelDiscovery.ts`：通过供应商接口发现可用模型。
7. `AgentSystemConfig.form.json`：表单结构定义。

## 扩展规则

- 新配置先改 `Types/Agent*ConfigTypes.ts` 对应领域文件、`Schemas/Agent*ConfigSchema.ts` 对应 schema 和 defaults。
- `Types/AgentConfigTypes.ts` 与 `Schemas/AgentSystemConfigSchema.ts` 是兼容入口，只做聚合和顶层装配。
- 需要前端编辑时，先改 `AgentSystemConfig.form.json`，必要时再扩展 form projector 和前端配置 UI。
- 供应商凭据属于 provider endpoint，模型能力属于 model 配置。
- 用户可编辑时间单位用秒，运行时内部再转换。
- 新增配置必须补配置投影或配置服务验证。
