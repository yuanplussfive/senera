# ModelEndpoints 模块导览

所有运行中的模型生成请求都使用 Pi 供应商适配器；业务功能提供数据和输出契约，不自行实现供应商 HTTP、SSE 或响应兼容解析。

## 阅读顺序

1. `AgentStructuredModelClient.ts`：native 必选 tool call 与正式 BAML 契约的共同入口。
2. `AgentPiModelRequestExecutor.ts`：Pi 请求、配置超时、取消、缓存、用量和耗时。
3. `AgentPiModelRequestProjection.ts`：消息与图片的供应商中立投影。
4. `AgentPiConfiguredProvider.ts`、`AgentNativeToolModelProjector.ts`：配置到 Pi provider/model 的投影。
5. `AgentModelEndpointContract.ts`、`AgentNativeToolApiStreams.ts`：声明的协议路由与 Pi adapter。
6. `AgentLanguageModel.ts`：业务调用的消息、图片与缓存数据契约。

## API 根路径与 Pi adapter

配置的 BaseUrl 表示供应商 API 根。路径重叠仅按完整 URL segment 处理，供应商 payload 和流解析由 Pi adapter 管理。native 和 BAML 使用同一供应商投影。新增协议或升级 SDK 时，需要验证真实 adapter 的最终请求 URL。

新增辅助模型功能请参阅 [公共请求架构](../../../docs/Architecture/AuxiliaryModelRequests.md)；新增协议请参阅 [开发手册](../../../docs/Development/AddModelEndpoint.md)。

## Thinking 等级合同

推理能力沿用 Pi 的可移植语义等级：`off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`。模型目录负责声明默认支持集合；模型配置只保存默认等级和可读 Profile，不再暴露供应商原生等级映射。

```json
{
  "ThinkingProfiles": [
    { "Id": "balanced", "Label": "均衡", "Level": "medium" },
    { "Id": "deep-review", "Label": "深度审查", "Level": "high" }
  ],
  "DefaultThinkingLevel": "medium"
}
```

`ThinkingProfiles` 是可读名称到标准等级的一对一别名，运行时仍只向 Pi adapter 传标准等级。模型目录内部的供应商适配信息仍由 Pi 自己维护；用户不需要在每个模型上重复维护一份映射表。
