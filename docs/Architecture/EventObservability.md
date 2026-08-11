# 事件观测架构

Senera 的事件观测面板用于诊断当前浏览器连接能看到的真实运行过程。它统一展示 WebSocket 连接生命周期、客户端命令和后端领域事件，但不是原始载荷抓包器，也不替代服务端持久日志或 OpenTelemetry。

## 数据链路

```text
后端领域事件
  -> AgentEventCatalog（layer / phase）
  -> AgentEventObservationCatalog（浏览器保留策略）
  -> 生成 Frontend EventSpecs
  -> WebSocket
  -> agentTransportObserver
  -> 有界 Event Journal
  -> Events 工作坞

客户端命令 / 连接状态
  -> agentTransportObserver（仅类型、关联 ID、状态和大小）
  -> 有界 Event Journal
```

认证准备流程会先安装 Event Journal recorder，再渲染主工作台或独立设置页。因此两个界面建立的 WebSocket 都进入同一个观测边界，首批连接和命令事件也不会因 React effect 顺序而丢失。事件面板本身保持懒加载。

## 正式运行阶段

`run.activity.changed` 是后端正式领域事件，不是终端文案。每个阶段包含：

- `activityId`：阶段实例 ID。
- `parentActivityId`：异步父阶段 ID；根阶段省略。
- `activity`：由 `AgentRunActivities` 声明的稳定阶段名。
- `state`：`started`、`completed` 或 `failed`。
- `startedAt`：开始事件和终态事件共享的 ISO 时间。
- `durationMs`：终态事件的单调时钟耗时。

`AgentRunActivityReporter` 使用异步上下文传播父阶段。并发子任务共享正确父阶段，不依赖进程级可变栈，也不会把兄弟任务错误投影为父子任务。活动类别由 `AgentRunActivitySpecTable` 统一声明并生成给前端。

工具生命周期也必须携带明确的时间边界。`tool.call.started` 使用后端采集的
`startedAt`，`tool.call.completed` 和 `tool.call.failed` 使用同一 `startedAt` 以及后端测量的
`durationMs`。浏览器诊断只消费这组字段；没有完整时间边界的历史记录仍可在技术事件视图中查看，
但不会被拼成一条时间段。

Pi collector 与普通 `AgentToolCallExecutor` 共用 `AgentLifecycleClock`：墙上时钟只负责生成
`startedAt`，单调时钟只负责计算 `durationMs`。这样系统时钟回拨不会制造负耗时，也不会让前端用
WebSocket envelope 的接收时间代替后端测量。

## 浏览器保留边界

`AgentEventObservationCatalog` 是浏览器诊断数据的安全边界。每个 `AgentEventKind` 必须显式选择：

- `metadata`：只保留事件类型、layer、phase、序号、时间和关联 ID。
- `projection`：额外保留声明的 RFC 6901 pointer。

需要在事件日志中作为过滤关联条件保留的 payload 标识，也必须在同一个 descriptor 中声明
`resourceIdPointer`；前端不会从 `data` 对象中按名称搜索 `resourceId` 或其他字段。

前端不按字段名猜测敏感信息。用户消息、模型增量、工具输出正文、工具结果、配置值、凭据和错误详情默认不会进入 Journal。新增事件如果没有保留声明，生成契约会失败；前端不能临时增加另一套字段白名单。

运行诊断视图只接受事件目录中带有 `diagnostic` descriptor 的生命周期事件。descriptor 由后端
`AgentEventObservationCatalog` 声明并生成到独立的 `generatedRuntimeDiagnosticCatalog`，包含来源、身份
指针、标签指针、状态指针或固定状态、开始时间指针和耗时指针。前端只按这个 descriptor 读取 RFC 6901
指针；没有 descriptor、指针值不完整或身份不一致的载荷直接拒绝，不扫描未知 payload，不按字段名猜测，
不用相邻事件时间戳补齐 `durationMs`。诊断 descriptor 只进入懒加载的诊断工作坞，不增加主应用的事件
目录负担。

出站命令只保留请求类型、安全关联 ID 和序列化大小，不保留请求正文。可选 raw-frame 模式只记录方向和帧大小，不保留帧内容。投影超过 64 KiB 时整份省略，不做可能误导诊断的局部截断。

## Journal 生命周期

Journal 是独立于会话状态的内存 store，默认记录并应用以下硬上限：

- 最多 2,000 条记录。
- 最多 2 MiB 实际保留数据。
- 最长 30 分钟。
- 单个声明式投影最多 64 KiB。

网络上观察到的帧大小和 Journal 实际保留大小分别计量；一个超大但未保留正文的请求不会错误驱逐整个日志。停止记录、暂停视图、开启 raw-frame 元数据和清空记录是四个独立操作。刷新页面会清空 Journal，不做跨会话持久化。

## 运行诊断视图

事件工作坞默认打开运行诊断视图。它和执行工作坞中的流程图职责不同：执行图描述 Pi 的步骤和因果关系，
运行诊断使用真实时间横轴和上下排列的组件泳道，表达持续时间、并发、当前活动和失败位置。泳道中的工具条
来自显式工具生命周期区间，不绘制新的节点或连线。技术事件视图仍保留完整的结构化事件过滤和 JSON 详情，
作为诊断视图的深入入口。

完成的区间使用后端 `durationMs`，进行中的区间从明确的 `startedAt` 延伸到当前时刻，终态但没有时长的记录
显示为未测量而不是 `0ms`。这保证视觉提示不会把未知数据伪装成精确测量。

## 扩展规则

新增或修改事件时按以下顺序维护：

1. 在后端事件类型和 `AgentEventSpecTable` 中声明协议。
2. 在 `AgentEventObservationSpecTable` 中明确浏览器保留策略。
3. 如有新的运行阶段，在 `AgentRunActivitySpecTable` 中声明类别。
4. 运行 `npm run generate.frontend-events`，不要手改生成目录。
5. 为投影安全、阶段生命周期和前端展示增加行为测试。
6. 运行 `npm run verify.frontend-events`、`npm run verify.i18n` 和前后端测试。

事件详情只用于当前用户的本地诊断。需要跨进程检索、长期指标或分布式 trace 时，应新增独立的服务端观测 sink，而不是放宽浏览器投影或把原始载荷写入 Journal。
