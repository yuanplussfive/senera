# 新增运行时事件开发手册

运行时事件连接后端主循环、终端 输出、WebSocket、前端状态和调试时间线。新增事件时要先确定它是运行时事实，而不是某个 UI 组件的临时状态。

## 事件链路

```text
状态变化来源
  -> 后端领域事件类型
  -> event factory / projector
  -> WebSocket envelope
  -> Frontend API event type
  -> session projector
  -> feature presentation
  -> 测试 / 验证
```

## 后端事件契约

先在后端事件类型层定义事件。事件应该描述一个已经发生的运行时事实：

- 发生了什么。
- 属于哪个 request、run、step、tool call、artifact 或 memory item。
- 它是 snapshot、patch、progress、error 还是 final result。
- 是否需要稳定 ID、时间戳、URI 或序号。

事件 payload 必须可序列化。已有 artifact、memory、session repository 能追溯的数据，优先传 ID 或 URI，不要把大对象直接塞进事件。

## 谁负责发事件

事件应该由状态变化的 owner 发出：

- loop step 变化由 loop state 或 command handler 发出。
- 工具执行事件由 tool execution / artifact recording 发出。
- planner 事件由 planner 或 projector 发出。
- memory 事件由 memory runtime 或 repository 发出。
- session snapshot 由 session manager 发出。

后端不要发前端布局决策，例如“打开哪个面板”“滚动到哪里”。这类事情属于前端 feature。

## 前端投影

后端领域事件由 `AgentWebSocketServer` 序列化。前端事件类型在 `Frontend/src/api` 下维护。

前端状态更新应该进入已有 owner：

- `Frontend/src/store/session`：会话、消息、run、timeline 状态。
- `Frontend/src/features/chat`：聊天区展示。
- `Frontend/src/features/workflow`：工作流和过程视图。
- `Frontend/src/shared`：只放领域无关 UI 和工具函数。

不要在多个组件里散落处理同一个事件。先把状态投影写清楚，再做 UI 展示。

## 必须验证

后端：

```bash
npm run check.types
npm run build
npm run verify.suite -- workspace core
```

前端：

```bash
npm run test.frontend
```

如果事件影响 session projector，优先补 projector 附近的测试，不要只测最终组件。

## 上线前检查

- 事件只有一个明确 owner。
- 事件名称描述运行时事实，不描述 UI 操作。
- payload 有稳定 ID、时间戳、URI 或序号。
- WebSocket 序列化能处理该事件。
- 前端 API 类型已更新。
- session 或 feature projector 已处理该事件。
- UI 展示和状态变更分离。
- 测试覆盖乱序、缺失、重复或迟到事件的关键场景。
