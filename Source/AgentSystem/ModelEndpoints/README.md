# ModelEndpoints 模块导览

ModelEndpoints 模块负责把不同供应商协议适配成统一模型接口。

## 阅读顺序

1. `AgentLanguageModel.ts`：Agent 内部统一模型接口和消息契约。
2. `AgentModelMetadata.ts`：模型供应商元数据、usage 和会话 metadata 类型。
3. `AgentModelEndpointClient.ts`：从系统配置解析供应商，并把请求路由到具体 endpoint。
4. `ModelEndpointTypes.ts`：内部统一端点类型和 endpoint factory。
5. `ModelHttpClient.ts`：HTTP 请求入口，负责 JSON 与 SSE 请求流程编排。
6. `ModelHttpAbort` / `ModelHttpRetry` / `ModelHttpErrors` / `ModelHttpUrl`：请求生命周期、重试、错误归一化和 URL 拼接。
7. `ModelSseStreamParser` / `ModelHttpJson`：SSE chunk 和 JSON 对象解析。
8. `ModelPayloadOptions.ts`：通用 payload 参数处理。
9. `OpenAiChatCompletionsEndpoint.ts` / `OpenAiResponsesEndpoint.ts`：OpenAI 系协议实现。
10. `ClaudeMessagesEndpoint.ts` / `GoogleGenerateContentEndpoint.ts`：非 OpenAI wire protocol 实现。
11. `OpenAiMessageProjection.ts`：OpenAI 消息形态投影。

## 扩展规则

- 只有 wire protocol 不同时才新增 endpoint kind。
- OpenAI-compatible 供应商优先走现有 Chat Completions endpoint。
- provider 特有字段不能泄漏到 planner 或 loop。
- streaming chunk 必须归一化成统一增量。
- 模型契约和模型入口归属本目录；`AgentSystem` 根目录只引用统一接口。
- 新增端点必须补模型端点配置和 timeout 验证。

## Native Tool 路由合同

Native Tool Calling 的 Pi adapter 只由模型声明的 Endpoint kind 选择，不能从模型名称、供应商名称或 Base URL 文本猜测协议。`AgentModelEndpointContract.ts` 同时声明 Endpoint 到 Pi API adapter 的映射，以及 adapter 自己会追加的 Base URL 路径段。

配置中的 `BaseUrl` 表示供应商 API 根。若 Pi SDK 已拥有相同的末尾路径，Senera 只按完整 URL segment 移除精确重叠，再把结果交给 SDK。例如 Anthropic adapter 自己追加 `/v1/messages`，所以配置 `https://chat.senerapi.com/v1` 会投影为 SDK base `https://chat.senerapi.com/`，最终请求仍是且仅是 `https://chat.senerapi.com/v1/messages`。`/v11` 不匹配，`/proxy/v1` 只移除末尾 `v1` 并保留代理前缀。

该归一化只属于 Native Pi 投影；BAML 和 Senera 自有 Endpoint 客户端继续使用各自的正式 URL 合同。新增 Endpoint 或升级 SDK 时，必须用 adapter 的真实 fetch 探针验证最终请求 URL，不能只断言中间字符串。
