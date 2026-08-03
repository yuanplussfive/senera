# Config 模块导览

Config 模块负责配置的读取、数据库镜像、表单投影和模型列表发现。

## 阅读顺序

1. `AgentConfigService.ts`：配置服务入口，负责 JSON 和 SQLite source 的统一快照。
2. `AgentConfigServicePaths` / `AgentConfigDiagnostics`：配置路径、JSON 镜像写入和诊断格式化。
3. `AgentConfigSecretProtection.ts` / `AgentConfigSqliteRepository.ts`：供应商凭据加密和配置数据库持久化。
4. `AgentConfigFormProjector.ts`：配置表单投影入口。
5. `AgentConfigFormDocument.ts` / `AgentConfigFormFieldProjector.ts` / `AgentConfigEffectiveProjector.ts`：表单说明文件校验、字段投影和 effective 配置投影。
6. `AgentProviderModelDiscovery.ts`：通过供应商接口发现可用模型。
7. `AgentProviderModelConfigCommands.ts`：Provider/Model 命令兼容导出入口；具体实现分布在 `AgentProviderEndpointConfigCommands.ts`、`AgentProviderModelConfigMutations.ts`、`AgentProviderModelConfigInvariants.ts` 和 `AgentProviderModelConfigCommandTypes.ts`。
8. `AgentSystemConfig.form.json`：表单结构定义。

## 扩展规则

- 新配置先改 `Types/Agent*ConfigTypes.ts` 对应领域文件、`Schemas/Agent*ConfigSchema.ts` 对应 schema 和 defaults。
- `Types/AgentConfigTypes.ts` 与 `Schemas/AgentSystemConfigSchema.ts` 是兼容入口，只做聚合和顶层装配。
- 需要前端编辑时，先改 `AgentSystemConfig.form.json`，必要时再扩展 form projector 和前端配置 UI。
- 供应商凭据属于 provider endpoint，模型能力属于 model 配置。
- `ModelProviderEndpoints[].ApiKey` 在内存和 WebSocket 快照中保持明文语义，只能在 JSON/SQLite 持久化边界加解密；新增存储路径不得绕过 `AgentConfigSecretCodec`。
- 配置命令幂等是有界协议：`CommandReceiptRetentionHours` 定义重试时间窗，`CommandReceiptMaxCount` 提供高流量硬上限。超出窗口或上限的 command ID 可以作为新命令再次使用。
- SQLite 清理先删除过期和超额 command receipt，再删除不在最近 `RevisionRetentionCount` 且不再被有效 receipt 引用的 revision；清理与命令提交使用同一事务。JSON source 的进程内 receipt ledger 必须应用相同策略。
- Provider rename 必须同步迁移规范模型 ID 及其配置引用，并保留 `ModelProviderIdAliases`，避免历史会话引用立即失效。
- Provider/Model mutation 只负责构造下一份配置；跨端点、模型、默认值、group 和 alias 的一致性规则集中在 invariants 模块。旧 commands 文件只作为稳定 import boundary，禁止重新堆叠命令实现。
- Provider model discovery cache 使用只包含 endpoint 非敏感元数据和配置 revision 的规范身份摘要，不读取 API key 或 headers 值参与哈希。带凭据的临时 endpoint 不进入缓存；持久化配置通过 revision 变化失效。缓存由显式 `maxEntries`/`ttlMs` 策略约束，命中时更新 LRU。
- `Server.AccessControl.Limits.MaxRateLimitClients` 是登录、HTTP、upgrade 和消息令牌桶可跟踪客户端数的共同上限；它约束内存和淘汰成本，不改变各自每分钟的配额。
- 用户可编辑时间单位用秒，运行时内部再转换。
- 新增配置必须补配置投影或配置服务验证。
