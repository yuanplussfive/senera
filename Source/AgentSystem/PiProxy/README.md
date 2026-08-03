# PiProxy 模块

PiProxy 是 Pi Coding Agent 与 Senera 模型编排之间的本地 OpenAI-compatible 适配器。它只负责 HTTP 协议、请求校验、模型配置路由、assistant 编译和响应投影，不拥有 Pi 会话，也不直接依赖 `Pi` 或 `ActionPlanner`。跨模块协议统一由 `PiShared` 持有，生产实现由 `Runtime` composition root 装配。

## 依赖边界

- `Pi`、`ActionPlanner` 不得导入 `PiProxy`。
- `PiProxy` 不得导入 `Pi` 或 `ActionPlanner`。
- 双方共享的 header、DTO、turn context 和 tool plan 状态放在 `PiShared`。
- `VerifyAgentTypeContractBoundaries` 通过 TypeScript AST 检查这些边界，并拒绝手写后端模块的运行时循环依赖。

本地 HTTP 适配仍然必要：Pi SDK 通过 OpenAI-compatible transport 发起请求，而 Senera 的 compiler 运行在服务端。这个传输边界不承载隐式全局状态，所有 turn 数据都由显式 context ID 关联。

```text
Pi OpenAI-compatible request
  -> header/body validation
  -> acquire turn-context reader lease
  -> AgentPiOpenAiPlanningProjector
  -> AgentPiAssistantCompiler
  -> ActionPlanner/BAML structured call
  -> validated assistant compilation
  -> OpenAI-compatible response projection
```

HTTP adapter、compiler 和 response writer 可以依赖 `PiShared` 与 ActionPlanner 的公开端口；它们不能读取 Pi session pool、JSONL 文件或进程级“当前会话”。Pi 侧只知道共享 wire protocol 和 context header，不知道 compiler 的实现。

## Turn Context

`AgentPiTurnContextRegistry` 是实例化的 owner/read lease registry。`ServerRuntime` 创建唯一实例，并同时注入 runtime cache 和 WebSocket server：

```ts
const piTurnContexts = new AgentPiTurnContextRegistry();

new AgentSystemRuntimeCache({ piTurnContexts, ...runtimeOptions });
new AgentWebSocketServer({ piTurnContexts, ...serverOptions });
```

`AgentPiTurnExecutor` 在 turn 开始时通过 `withContext()` 注册 owner，在 Pi SDK 的请求 header 中发送 `x-senera-pi-context-id`。`AgentPiProxyHttpApi` 在处理整个请求期间持有 reader lease。owner 结束后不再接受新 reader；已有 reader 释放后，registry 才删除 context 及其 tool batch/result 状态。

这里不使用模块级 `Map` 或 `AsyncLocalStorage`。上下文跨越真实 HTTP 边界，必须由显式、不可猜测的 ID 传递。缺失、未知或已过期 ID 一律返回 `400 invalid_pi_context`，不得使用空 grant、默认上下文或 first match 回退。

## 模型路由

Pi 请求必须携带：

- `x-senera-model-provider-id`: 会话选择的 `ModelProviders[].Id`
- `x-senera-pi-context-id`: 当前 turn context ID

模型 provider ID 唯一决定 endpoint、API key、模型和运行时参数。请求体 `payload.model` 只是 OpenAI wire 字段，不能用来猜测 provider；同一个模型名可以出现在多个配置中。

| provider header  | context header   | 行为                              |
| ---------------- | ---------------- | --------------------------------- |
| 已配置 ID        | active ID        | 使用指定 provider 和 turn context |
| 缺失、空白或未知 | 任意             | `400 invalid_model_provider`      |
| 已配置 ID        | 缺失、未知或过期 | `400 invalid_pi_context`          |

代理不会回退 `DefaultModelProviderId`，也不会按 payload 字段选择第一个匹配项。

## 规划投影

`AgentPiPlanningSkill` 是稳定的显式 DTO，不直接复用完整 `AgentActivatedSkill`。投影只允许模型决策需要的字段：

- `name`、`title`、`summary`
- `useCases`、`avoid`、`recommendedTools`
- `evidenceRequirements`

运行时选择元数据 `descriptionFile`、`revision`、`score`、`matchedTerms` 和 `matchedFields` 不进入规划 prompt。新增字段必须先明确其模型语义和信息暴露影响，再更新 DTO 与投影测试，不能自动透传源对象。

`AgentPiToolPlanCoordinator` 保存整个局部 DAG。无依赖节点可以并行发送；依赖全部完成后，后继节点直接进入参数物化。失败节点会阻断其后继，`waiting` observation 不视为成功。同一个节点只能从 `planned` 进入 `dispatched` 一次。

## 错误边界

- 请求 schema、provider header 和 context header 都在 compiler 调用前校验。
- 对外错误使用稳定 OpenAI-compatible envelope，不暴露 provider cause。
- provider cause 只进入经过脱敏和大小限制的诊断事件。
- 诊断 sink 是 best-effort；sink 抛错不能覆盖 provider 错误或改变 HTTP 结果。
- HTTP server 对 router Promise 的最终 rejection 返回稳定 500；headers 已发送时关闭响应。

## 测试要求

- `PiTurnContextRegistryBehavior.test.ts` 覆盖 owner/read lease、并发隔离、缺失和 stale ID。
- `PiProxyHttpApiBehavior.test.ts` 覆盖 context 拒绝及诊断 sink 故障隔离。
- `PiToolPlanCoordinatorBehavior.test.ts` 覆盖依赖推进、失败阻断、`waiting` 和参数物化失败。
- `VerifyPiProxyOpenAiWire` 覆盖 header 合并、provider 路由、上下文投影和 OpenAI wire 响应。
- `VerifyAgentTypeContractBoundaries` 覆盖模块方向和运行时循环依赖。
