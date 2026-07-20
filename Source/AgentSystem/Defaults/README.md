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

## Pi Proxy 会话模型路由契约

### 1. Scope / Trigger

Pi Harness 经由本地 OpenAI-compatible Pi Proxy 请求模型时，会话选择的
`ModelProviders[].Id` 必须贯穿到代理的 provider resolver。缺失这条契约时，
代理会重新读取 `DefaultModelProviderId`，并可能把正确的会话模型发送到错误的
上游端点。

### 2. Signatures

- `AgentPiProxyModelProviderHeader = "x-senera-model-provider-id"`
- `projectSeneraModelProviderToPi(provider, config)` 在 Pi provider headers 中写入
  `provider.Id`。
- `composePiProxyRequestHeaders(providerHeaders, piProxyRuntimeContextId?)`
  必须同时保留 provider header 和 `x-senera-pi-context-id`。
- `AgentPiProxyHttpApi` 使用该 header 解析 compiler 和 ActionPlanner 的基础
  provider。

### 3. Contracts

```ts
headers: {
  [AgentPiProxyModelProviderHeader]: provider.Id,
}
```

该值是模型配置 ID，不是共享 endpoint 的 `ProviderId`，也不能由 OpenAI 请求体的
`model` 名称反推。模型名可以在多个配置中重复；provider ID 才唯一选择 endpoint、
API key、模型和运行时参数。

`ActionPlanner.Client` 或 `PlanningClient` 显式设置
`ModelProviderId` 时，那个配置是有意的 planner 覆盖策略；它不同于 Pi Proxy 丢失
会话 provider 后的默认值回退，不能混为一类问题。

### 4. Validation & Error Matrix

| 请求 header         | 代理行为                                            |
| ------------------- | --------------------------------------------------- |
| 未提供              | 为旧 Pi 客户端兼容，使用全局默认模型配置            |
| 已提供且为已配置 ID | 使用该模型配置构造 compiler 与 planner              |
| 空字符串或纯空白    | 返回 `400 invalid_model_provider`                   |
| 未知 ID             | 返回 `400 invalid_model_provider`，不得回退默认模型 |

### 5. Good / Base / Bad Cases

- Good: 默认 Mistral、请求 header 为 `deepseek-flash` 时，proxy 使用 DeepSeek
  endpoint 和 `deepseek-v4-flash`。
- Base: 没有 header 的旧请求仍使用配置的默认模型。
- Bad: 只看 `payload.model` 或遇到未知 header 时静默选择默认模型。

### 6. Tests Required

`VerifyPiProxyOpenAiWire` 必须覆盖投影 header、Harness header 合并、已选择
provider、无 header 回退，以及空白和未知 provider 的拒绝。该脚本属于 core
verification suite。

### 7. Wrong vs Correct

```ts
// Wrong: loses the session-scoped provider at the proxy boundary.
const provider = resolveModelProviderConfig(config);

// Correct: an absent header alone uses the default; a present header is strict.
const provider = resolvePiProxyModelProvider(config, modelProviderHeader);
```

## 模型运行时租约与 Pi 流事件契约

### 1. Scope / Trigger

模型切换会创建完整的 `AgentSystemRuntime`，其中包含插件注册、执行环境、工具搜索、
Action Planner 和 Pi Harness。按 provider 无限缓存这些对象会使 Electron 主进程的内存
随着模型选择持续增长。Pi 的高频 `message_update` 若绕过异步订阅者的完成信号，还会
积累事件队列和完整 trace payload。

### 2. Signatures

- `AgentSystemRuntimeCache.acquire(modelProviderId?)` 返回
  `{ runtime, release() }`，不再暴露无生命周期的 `get()`。
- `AgentPiSessionMutationServiceOptions.acquireRuntime(modelProviderId?)`
  仅为已有 Pi 会话的 rewind/reset 获取运行时租约；创建空会话不会构建 Pi runtime。
- Pi JSONL 与 harness 只在首个实际 turn 的 `leaseTurn()` 中惰性建立，
  `PiTurnLeaseTimeoutSeconds` 约束该租约阶段，而不是 `session.create`。
- `RunSettlementTimeoutSeconds` 约束 destructive branch transition 等待旧 run、审批、工具和 Pi
  harness 进入空闲状态的时间；超时只拒绝新操作，不绕过分支隔离屏障。
- `AgentPiHarnessSession.subscribe(listener)` 必须返回 core listener 的
  `void | Promise<void>` 结果，供 Pi Harness 等待。
- `AgentPiTurnExecutor` 必须把 `collector.collect(event)` 直接作为 session
  subscriber 的返回值，不能在中间层使用 `void` 丢弃它。
- `AgentLoop.PiSessions.MaxCachedSessions` 同时约束打开的 Pi session tree 与 idle harness；
  active lease 只能在 release 后参与 LRU 淘汰。默认值由 `AgentDefaultCatalog` 提供。

### 3. Contracts

```ts
const lease = runtimeCache.acquire(modelProviderId);
try {
  return await loop.run(request);
} finally {
  lease.release();
}
```

默认缓存只保留一个最近使用的空闲 runtime。创建另一个 provider 的 runtime 前，必须
关闭所有空闲 entry；有 active lease 的 entry 不得被关闭。配置版本变化时，旧的 active
generation 可以短暂与新 generation 共存，直到旧租约释放。

`message_update` 只投影为 `model.delta`，不额外创建 Pi trace。其他 Pi trace 的字符串、
数组、对象属性和递归深度必须受限，再发送到 WebSocket 或写入 run history。
属性上限必须在读取属性值前生效；`Object.entries(payload).slice(...)` 会先遍历并分配
整个宽对象，因此不满足内存边界。

同一 runtime 内的 Pi harness 以会话 ID 为键复用，但仅保留最近的 idle harness。
淘汰时释放 hooks 并 abort 旧 harness；下一次访问通过持久 Pi `Session` 重建上下文，
active harness 则始终保留到 lease release。

新建空 Senera 会话不构造 runtime，也不建立 Pi JSONL。首个实际 `session.message` 通过
`create_if_missing` 原子建立 Senera 会话，Pi 只在 `leaseTurn()` 中 `open_or_create`。
同一会话后续回合优先复用 harness 持有的 persistent session，避免每轮
`readTextFile + split + JSON.parse` 整棵树。metadata 在首次 turn lease 时建立一次完整索引，
后续按 session ID 查找。

### 4. Validation & Error Matrix

| 条件                                    | 行为                                                   |
| --------------------------------------- | ------------------------------------------------------ |
| 同 provider、同配置 fingerprint         | 复用 runtime 并增加 lease                              |
| 切换 provider，旧 runtime 空闲          | 先关闭旧 runtime，再构造新 runtime                     |
| 切换 provider，旧 runtime active        | 保留旧 runtime，直到 release                           |
| Pi turn lease 超时但租约 Promise 未结束 | 迟到的 session 自动 dispose，不泄漏 harness lease      |
| `message_update`                        | 保留 `model.delta`；不发送或持久化完整 Pi trace        |
| executor 的 slow `model.delta` sink     | prompt 等待 collector 完成，不能绕过为 fire-and-forget |
| trace payload 有数百个属性              | 只读取摘要和 sanitation 上限内的属性                   |
| idle Pi harness 超过上限                | 淘汰 LRU idle harness，不 abort active harness         |

### 5. Good / Base / Bad Cases

- Good: Flash run 已结束后切到 Pro，Flash runtime 在 Pro runtime 构造前关闭。
- Base: 同一 provider 的连续请求复用最近的 idle runtime。
- Bad: 在 `loop.run()` 外释放租约，或在 Pi subscriber 中使用 `void listener(event)`；
  前者可能关闭活跃 session，后者会失去 provider 流的背压。
- Good: executor 回调直接返回 `collector.collect(event)`，慢 sink 会延后 prompt 完成。
- Good: 释放第二个 idle session 不影响仍 active 的第一个 session；第一个 release 后
  才按 LRU 淘汰旧 harness。

### 6. Tests Required

- `AgentSystemRuntimeCache.test.ts` 覆盖同 provider 复用、空闲先关闭、active lease
  保护、配置 generation 和 idempotent release。
- `PiStreamingStability.test.ts` 覆盖 harness 等待 async listener、`model.delta`
  顺序、executor 的慢 sink 背压、`message_update` 不产生 Pi trace、宽对象读取上限和
  trace payload 截断。
- `AgentPiHarnessSessionPool.test.ts` 覆盖 idle LRU 淘汰和 active harness 保护。

### 7. Wrong vs Correct

```ts
// Wrong: keeps a full runtime forever and breaks the async completion chain.
const runtime = runtimeCache.get(modelProviderId);
session.subscribe((event) => {
  void collector.collect(event);
});

// Correct: the caller owns a lease and every subscriber returns its Promise.
const lease = runtimeCache.acquire(modelProviderId);
session.subscribe((event) => collector.collect(event));
```
