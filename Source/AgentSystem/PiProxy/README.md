# PiProxy 模块

PiProxy 把不同供应商的文本生成统一暴露为本地 OpenAI-compatible 服务，供 Pi Harness 调用。这份文档记录会话模型路由契约——它保证用户在会话里选择的模型配置能贯穿到真正的上游端点。

## 会话模型路由契约

Pi Harness 经由 Pi Proxy 请求模型时，会话选择的 `ModelProviders[].Id` 必须一路传到代理的 provider resolver。丢掉这条链，代理就会重新读取 `DefaultModelProviderId`，把正确的会话模型发到错误的上游端点。

### 关键签名

- `AgentPiProxyModelProviderHeader = "x-senera-model-provider-id"`
- `projectSeneraModelProviderToPi(provider, config)` 在 Pi provider headers 中写入 `provider.Id`。
- `composePiProxyRequestHeaders(providerHeaders, piProxyRuntimeContextId?)` 必须同时保留 provider header 和 `x-senera-pi-context-id`。
- `AgentPiProxyHttpApi` 使用该 header 解析 compiler 和 ActionPlanner 的基础 provider。

```ts
headers: {
  [AgentPiProxyModelProviderHeader]: provider.Id,
}
```

### 两个容易混淆的点

header 里的值是模型配置 ID，不是共享 endpoint 的 `ProviderId`，也不能由 OpenAI 请求体的 `model` 名称反推——模型名可以在多个配置中重复，provider ID 才唯一决定 endpoint、API key、模型和运行时参数。

`ActionPlanner.Client` 或 `PlanningClient` 显式设置 `ModelProviderId` 时，那是有意的 planner 覆盖策略；它不同于 Pi Proxy 丢失会话 provider 后的默认值回退，不能混为一类问题。

### 行为矩阵

| 请求 header         | 代理行为                                            |
| ------------------- | --------------------------------------------------- |
| 未提供              | 为旧 Pi 客户端兼容，使用全局默认模型配置            |
| 已提供且为已配置 ID | 使用该模型配置构造 compiler 与 planner              |
| 空字符串或纯空白    | 返回 `400 invalid_model_provider`                   |
| 未知 ID             | 返回 `400 invalid_model_provider`，不得回退默认模型 |

举例：默认模型是 Mistral、请求 header 为 `deepseek-flash` 时，proxy 必须使用 DeepSeek endpoint 和对应模型；没有 header 的旧请求仍用默认模型。只看 `payload.model`，或对未知 header 静默选择默认模型，都是这条契约明确禁止的行为。

```ts
// Wrong: loses the session-scoped provider at the proxy boundary.
const provider = resolveModelProviderConfig(config);

// Correct: an absent header alone uses the default; a present header is strict.
const provider = resolvePiProxyModelProvider(config, modelProviderHeader);
```

### 测试要求

`VerifyPiProxyOpenAiWire` 必须覆盖投影 header、Harness header 合并、已选择 provider、无 header 回退，以及空白和未知 provider 的拒绝。该脚本属于 core verification suite。
