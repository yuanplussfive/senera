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
