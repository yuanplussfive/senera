# Pi 模块

Pi 负责会话、流式文本、工具调用和多步循环。这份文档记录运行时租约与流事件的内存契约。它存在的原因很直接：模型切换会创建完整的 `AgentSystemRuntime`（插件注册、执行环境、工具搜索、Action Planner、Pi Harness 全在里面），按 provider 无限缓存这些对象会让 Electron 主进程的内存随着模型选择持续增长；Pi 的高频 `message_update` 若绕过异步订阅者的完成信号，还会积累事件队列和完整 trace payload。

## 关键签名

- `AgentSystemRuntimeCache.acquire(modelProviderId?)` 返回 `{ runtime, release() }`，不再暴露无生命周期的 `get()`。
- `AgentPiSessionMutationServiceOptions.acquireRuntime(modelProviderId?)` 仅为已有 Pi 会话的 rewind/reset 获取运行时租约；创建空会话不会构建 Pi runtime。
- Pi JSONL 与 harness 只在首个实际 turn 的 `leaseTurn()` 中惰性建立，`PiTurnLeaseTimeoutSeconds` 约束该租约阶段，而不是 `session.create`。
- `RunSettlementTimeoutSeconds` 约束 destructive branch transition 等待旧 run、审批、工具和 Pi harness 进入空闲状态的时间；超时只拒绝新操作，不绕过分支隔离屏障。
- `AgentPiHarnessSession.subscribe(listener)` 必须返回 core listener 的 `void | Promise<void>` 结果，供 Pi Harness 等待。
- `AgentPiTurnExecutor` 必须把 `collector.collect(event)` 直接作为 session subscriber 的返回值，不能在中间层用 `void` 丢弃它。
- `AgentLoop.PiSessions.MaxCachedSessions` 同时约束打开的 Pi session tree 与 idle harness；active lease 只能在 release 后参与 LRU 淘汰。默认值由 `AgentDefaultCatalog` 提供。

## 租约规则

```ts
const lease = runtimeCache.acquire(modelProviderId);
try {
  return await loop.run(request);
} finally {
  lease.release();
}
```

默认缓存只保留一个最近使用的空闲 runtime。创建另一个 provider 的 runtime 前，必须关闭所有空闲 entry；有 active lease 的 entry 不得被关闭。配置版本变化时，旧的 active generation 可以短暂与新 generation 共存，直到旧租约释放。

## 流事件与内存边界

`message_update` 只投影为 `model.delta`，不额外创建 Pi trace。其他 Pi trace 的字符串、数组、对象属性和递归深度必须受限，再发送到 WebSocket 或写入 run history。属性上限必须在读取属性值前生效——`Object.entries(payload).slice(...)` 会先遍历并分配整个宽对象，不满足内存边界。

## 会话与 harness 复用

同一 runtime 内的 Pi harness 以会话 ID 为键复用，但仅保留最近的 idle harness。淘汰时释放 hooks 并 abort 旧 harness；下一次访问通过持久 Pi `Session` 重建上下文，active harness 则始终保留到 lease release。

新建空 Senera 会话不构造 runtime，也不建立 Pi JSONL。首个实际 `session.message` 通过 `create_if_missing` 原子建立 Senera 会话，Pi 只在 `leaseTurn()` 中 `open_or_create`。同一会话后续回合优先复用 harness 持有的 persistent session，避免每轮 `readTextFile + split + JSON.parse` 整棵树。metadata 在首次 turn lease 时建立一次完整索引，后续按 session ID 查找。

## 行为矩阵

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

几个具体场景：Flash run 已结束后切到 Pro，Flash runtime 必须在 Pro runtime 构造前关闭；同一 provider 的连续请求复用最近的 idle runtime；释放第二个 idle session 不影响仍 active 的第一个，第一个 release 后才按 LRU 淘汰旧 harness。在 `loop.run()` 外释放租约（可能关闭活跃 session）和在 Pi subscriber 中写 `void listener(event)`（失去 provider 流的背压）都是这条契约要防的事故。

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

## 测试要求

- `AgentSystemRuntimeCache.test.ts` 覆盖同 provider 复用、空闲先关闭、active lease 保护、配置 generation 和 idempotent release。
- `PiStreamingStability.test.ts` 覆盖 harness 等待 async listener、`model.delta` 顺序、executor 的慢 sink 背压、`message_update` 不产生 Pi trace、宽对象读取上限和 trace payload 截断。
- `AgentPiHarnessSessionPool.test.ts` 覆盖 idle LRU 淘汰和 active harness 保护。
