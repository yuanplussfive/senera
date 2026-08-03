# Loop 模块

`Loop` 是单个用户回合的外层编排边界。它初始化运行时、准备本轮能力、渲染系统提示词、租用一个持久 Pi 会话，并把终态交给 Session 的原子提交边界。Loop 不再维护平行的“理解/路由”状态机，也不在 Pi 之前调用一次规划模型。

## 当前执行链

```text
AgentLoop.run
  -> runtime.initialize
  -> fresh Tool/Skill retrieval
  -> AgentTurnPreparationService
     -> activate Skills
     -> merge preferred and discovered Tools
     -> build RootCommand + immutable toolAccessGrant
  -> AgentTurnPromptRenderer
  -> AgentPiTurnExecutor
     -> project product conversation
     -> register turn-context owner lease
     -> lease persistent Pi Coding Agent session
     -> prompt and drain ordered events
  -> terminal Session commit callback
```

## 模块职责

- `AgentLoop`：公开入口和顺序编排；生成 run/prompt/terminal 事件，复用有效的 turn-preparation snapshot，并保证 retrieval 请求最终收口。
- `AgentTurnPreparationService`：激活 Skills、合并初始工具检索与 Skill 推荐、构造 RootCommand 和不可变 `toolAccessGrant`。这里没有 BAML 调用。
- `AgentTurnPreparationSnapshot`：持久化与运行 fingerprint 绑定的 grant、工具曝光、RootCommand、活动 Skills 和 Pi branch boundary；配置或合同变化后不得复用。
- `AgentTurnPromptRenderer`：从注册模板和 prompt-context service 渲染本轮 system prompt，并计算 token 数。
- `AgentPiTurnExecutor`：建立 turn context、投影历史与当前输入、租用 Pi session、收集流事件和工具结果，并返回一次完整 Pi turn 的结果。
- `AgentLoopEventFactory` 及领域 event factories：生成稳定领域事件；事件持久化和发布顺序由 Session 层拥有。
- `AgentLoopRunner`：Session 依赖的最小运行端口，避免 Session 反向依赖具体 Loop 实现细节。

## 边界规则

- Loop 可以编排 runtime service，但不实现规划算法、模型供应商协议、工具执行、会话数据库或 Artifact 保留策略。
- 当前轮的首次检索直接使用当前用户输入。短 follow-up 的兼容快照只是零命中 warm cache，不额外合成一次隐式的上下文化检索阶段。
- PiProxy 中的 `EvolveTurn`、参数物化和 repair 驱动 Pi 内部多步循环；Loop 不复制这套决策状态。
- `preferredToolNames ⊆ exposedToolNames ⊆ authorizedToolNames ⊆ registeredToolNames`。Loop 只建立初始集合；同一回合后续曝光由 ToolSearch 和 `AgentToolExposureState` 处理。
- `commitTerminalEvents` 存在时，Loop 不自行发布终态。Session 必须先原子写入最终对话、run snapshot、trace 和 durable events，再向订阅者发布。
- 取消、超时和异常都必须经过 `finally` 释放 retrieval、turn context 和 Pi session lease；不得引入模块级默认上下文或 fire-and-forget 的关键收尾。

新增回合阶段前，应先判断它属于 preparation、prompt projection、Pi turn 还是 Session commit。只有形成独立失败边界和清晰所有权时才增加新协作者，不恢复已经删除的通用命令状态机。
