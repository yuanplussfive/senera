# 新增模型端点开发手册

模型端点负责把供应商 API 适配成 Senera 内部统一的语言模型接口。主循环、规划器、工具执行层不应该知道供应商的请求字段细节。

## 现有端点位置

模型端点实现位于：

```text
Source/AgentSystem/ModelEndpoints/
```

当前主要协议包括：

- OpenAI Responses
- OpenAI-compatible Chat Completions
- Claude Messages
- Google GenerateContent

通用逻辑放在 `ModelHttpClient`、`ModelPayloadOptions` 或中立的 projection helper。供应商特有请求、响应、流式 chunk 解析留在具体 endpoint 文件里。

## 通常需要修改的文件

```text
Source/AgentSystem/ModelEndpoints/<ProviderEndpoint>.ts
Source/AgentSystem/ModelEndpoints/ModelEndpointTypes.ts
Source/AgentSystem/AgentModelEndpointClient.ts
Source/AgentSystem/Types/AgentConfigTypes.ts
Source/AgentSystem/Schemas/AgentSystemConfigSchema.ts
Source/AgentSystem/Defaults/*
Source/AgentSystem/Config/AgentConfigFormProjector.ts
Frontend/src/features/settings/SettingsWorkbench.tsx
Frontend/src/features/settings/sections/ModelServiceSection.tsx
Frontend/src/features/settings/sections/ProviderModelManagementSurface.tsx
Frontend/src/app/useConfigMutationController.ts
Scripts/VerifyModelProviderEndpointConfig.ts
Scripts/VerifyModelTimeoutConfig.ts
```

只有用户可见配置形态变化时，才需要改前端供应商/模型配置 UI。

## 什么时候需要新增 Endpoint Kind

只有 wire protocol 真的不同，才新增 endpoint kind。

如果供应商兼容 OpenAI Chat Completions，就使用现有 OpenAI-compatible endpoint，通过 base URL、headers、model、capability tags 配置，不要为了供应商品牌新增一套重复端点。

新增端点契约必须覆盖：

- 非流式 completion。
- 流式 completion。
- AbortSignal。
- headers 和鉴权。
- 请求超时和首 token 超时。
- 最大输出 token 策略。
- 供应商特有 options。
- 错误归一化。

## 运行时要求

endpoint 必须返回 Senera 内部统一的模型结果形态，不能把供应商 raw chunk 泄漏给 loop 或 planner。

流式 endpoint 必须把供应商增量归一化到现有 model event 链路。

错误要在 endpoint 层归一化，主循环只消费统一错误结构。

## 配置要求

供应商配置和模型配置要分清：

- 供应商保存 base URL、API key、headers、协议类型。
- 模型保存模型名、能力标签、运行参数。
- 需要 embedding / rerank / vision 的功能应该选择带对应能力的模型，而不是重复写 API key。

改配置时必须同步：

- TypeScript config types。
- runtime schema。
- defaults。
- config form projection。
- 前端配置控件。
- 验证脚本和 fixtures。

用户可编辑的时间配置用秒，不要在 UI 里直接暴露毫秒。

## 必须验证

基础验证：

```bash
npm run check.types
npm run build
npm run verify.suite -- workspace core
```

模型相关重点验证：

```bash
node Dist/Scripts/VerifyModelProviderEndpointConfig.js
node Dist/Scripts/VerifyModelTimeoutConfig.js
node Dist/Scripts/VerifyVectorModelClient.js
```

真实外部 API 探测不要进入普通 CI。它可以读取本地私有配置，但必须保持在显式手动脚本里。

## 上线前检查

- 确实需要新增 endpoint kind，而不是 OpenAI-compatible 配置就能解决。
- 供应商私有请求和流式解析没有泄漏到主循环。
- 错误已经归一化。
- schema、defaults、form projection、前端 UI 保持一致。
- timeout、retry、max output token 的语义一致。
- 验证覆盖端点路由、超时、配置投影、前端选择逻辑。
