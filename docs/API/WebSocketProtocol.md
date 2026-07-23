# WebSocket 协议参考

> 本文档由 WebSocket 请求 schema 和运行时事件目录生成，请勿直接编辑。

## 范围

本文档描述 Senera Server 暴露的双向 WebSocket 端点。客户端消息会被严格校验，服务端消息使用统一事件 envelope。上传 HTTP 接口和模型供应商 API 不属于本协议。

连接到服务根 WebSocket 地址，例如 `ws://127.0.0.1:8787`。实际地址以服务端配置的 Host 和 Port 为准。

## 管理员认证

当服务的 `Server.AccessControl` 要求认证时，浏览器必须先在同源 HTTPS 页面完成管理员登录。会话由 HttpOnly Cookie 承载；不要将密码、Cookie 或会话 token 放入 WebSocket URL、本地存储或日志。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/auth/session` | 获取当前登录状态；未登录时返回 401。 |
| `POST` | `/api/auth/login` | 提交 `{ loginName, password }`，成功后设置 HttpOnly session Cookie，并返回内存 CSRF token。 |
| `POST` | `/api/auth/logout` | 需要 `X-Senera-Csrf`，撤销当前会话并清除 Cookie。 |

服务端会在 WebSocket 升级前验证 Cookie 和 Origin。未认证、跨 Origin、超出连接配额或超过握手频率的连接不会建立。远程部署必须使用 HTTPS/WSS；反向代理终止 TLS 时仅应配置明确可信的代理地址。

## 客户端请求

完整、可机器校验的请求契约见 [`WebSocketProtocol.schema.json`](WebSocketProtocol.schema.json)。未知请求字段会被拒绝。

| `type` | 用途 |
| --- | --- |
| `approval.resolve` | 提交审批决定：单次允许、会话允许、拒绝继续或拒绝并中断。 |
| `config.get` | 获取当前有效系统配置及表单投影。 |
| `config.update` | 保存完整系统配置，可选择同步 JSON 镜像。 |
| `execution.resource.inspect` | 按游标检查指定后台执行资源。 |
| `execution.resource.list` | 列出指定会话拥有的后台执行资源。 |
| `execution.resource.resize` | 调整指定 PTY 终端的字符网格尺寸。 |
| `execution.resource.signal` | 向指定后台执行资源发送控制信号。 |
| `execution.resource.stop_all` | 停止指定会话拥有的全部活动后台执行资源。 |
| `execution.resource.write` | 向指定后台终端或进程写入输入。 |
| `interaction.input.resolve` | 提交 MCP 表单交互结果：接受并返回字段、明确拒绝或取消。 |
| `model.list` | 获取已配置模型提供方及默认模型。 |
| `plugin.config.list` | 获取可配置插件及其诊断信息。 |
| `plugin.config.set_enabled` | 切换插件或插件内单个工具的启用状态。 |
| `plugin.config.update` | 保存一个插件的 TOML 配置。 |
| `preset.delete` | 删除指定预设。 |
| `preset.list` | 获取角色预设列表与当前激活项。 |
| `preset.save` | 创建或更新预设，并可在保存后激活。 |
| `preset.set_active` | 设置当前激活预设，`name: null` 表示取消激活。 |
| `profile.get` | 获取用户画像。 |
| `profile.update` | 更新用户名称和头像等画像字段。 |
| `provider.defaultModel.set` | 设置当前默认模型。 |
| `provider.endpoint.delete` | 删除一个模型服务端点，并按请求处理关联模型。 |
| `provider.endpoint.rename` | 重命名模型服务端点，同时保持关联模型一致。 |
| `provider.endpoint.upsert` | 创建或更新一个模型服务端点。 |
| `provider.model.bulkImport` | 批量导入模型服务中的模型。 |
| `provider.model.delete` | 删除一个模型，并按请求处理默认模型。 |
| `provider.model.upsert` | 创建或更新一个模型服务中的模型。 |
| `provider.models.fetch` | 从指定模型端点刷新可用模型列表。 |
| `sandbox.status` | 获取当前沙箱运行时状态和降级信息。 |
| `session.cancel` | 取消会话当前正在执行的请求。 |
| `session.close` | 关闭并从服务端删除会话。 |
| `session.create` | 创建会话；可选指定会话和模型提供方。 |
| `session.fork` | 复制指定请求及之前的完整可重放状态，创建独立会话分支。 |
| `session.history` | 拉取指定会话的可重放历史；`refresh` 用于主动重新同步。 |
| `session.list` | 获取服务端当前可用会话的摘要列表。 |
| `session.message` | 向会话提交用户输入，可附带上传附件或队列模式。 |
| `session.regenerate` | 从指定请求起截断旧分支，并在同一命令中提交替代输入。 |
| `session.rename` | 更新会话显示标题。 |
| `session.truncate_from` | 从指定请求起截断会话历史。 |

### 请求示例

```json
{
  "type": "session.message",
  "sessionId": "session_01",
  "requestId": "request_01",
  "input": "Summarize the current workspace."
}
```

请求结构不合法时，服务端会发送 `request.invalid`。成功请求不会返回独立 ACK，而是通过下方领域事件表达过程和结果。

### 审批决定

`approval.resolve` 接收声明式 `decision`，不接收客户端指定的终态。`approve_once` 只允许当前调用，`approve_session` 在当前会话内授予同一审批主体，`deny` 拒绝当前操作但允许 Agent 继续，`deny_and_interrupt` 同时中断当前运行。服务端据此生成 `approved`、`denied`、`cancelled` 或 `expired` 终态及 `proceed`、`continue` 或 `interrupt` disposition。

```json
{
  "type": "approval.resolve",
  "approvalId": "approval_01",
  "decision": "approve_once"
}
```

审批状态由服务端维护。客户端应以 `approval.requested` 和 `approval.resolved` 为准，使用 `approvalId` 关联一次审批，并使用事件 envelope 的 `sessionId`、`requestId`、`step` 以及载荷中的 `toolCallId`、`batchId` 关联具体执行。取消和过期同样会产生 `approval.resolved`，不能通过本地删除待审批项推断终态。

## 服务端事件 Envelope

每条服务端消息都是以下形状的 JSON 对象：

```json
{
  "channel": "agent.event",
  "kind": "model.delta",
  "layer": "progress",
  "phase": "model",
  "sequence": 42,
  "timestamp": "2026-07-12T12:00:00.000Z",
  "sessionId": "session_01",
  "requestId": "request_01",
  "step": 1,
  "data": { "text": "Partial output" }
}
```

| 字段 | 含义 |
| --- | --- |
| `channel` | 固定为 `agent.event`。 |
| `kind` | 下方目录中的稳定事件标识。 |
| `layer` | 投递语义：`progress`、`snapshot`、`terminal` 或 `error`。 |
| `phase` | 事件 owner：request、session、prompt、model、decision、tool、run、approval、sandbox 或 config。 |
| `sequence` | 服务端单调递增序号，用于排列当前连接收到的事件；不是可持久化的回放游标。 |
| `timestamp` | 服务端 ISO-8601 时间戳。 |
| `sessionId` / `requestId` / `step` | 可选关联上下文，是否存在由具体事件契约决定。 |
| `scope` / `detailId` | 可选的工作流和详情关联元数据。 |
| `data` | 事件专属 payload；表格链接到精确的 TypeScript 契约。 |

## 事件目录

下方条目直接由后端事件目录生成。每个 `kind` 的 `layer` 与 `phase` 固定，客户端应同时校验两者。链接的 payload contract 是 `data` 字段的权威定义。

| 事件 | Layer | Phase | Payload 契约 |
| --- | --- | --- | --- |
| `session.created` | `snapshot` | `session` | [会话事件类型](../../Source/AgentSystem/Session/AgentSessionEventTypes.ts) |
| `session.snapshot` | `snapshot` | `session` | [会话事件类型](../../Source/AgentSystem/Session/AgentSessionEventTypes.ts) |
| `session.closed` | `terminal` | `session` | [会话事件类型](../../Source/AgentSystem/Session/AgentSessionEventTypes.ts) |
| `session.busy` | `error` | `session` | [会话事件类型](../../Source/AgentSystem/Session/AgentSessionEventTypes.ts) |
| `session.not_found` | `error` | `session` | [会话事件类型](../../Source/AgentSystem/Session/AgentSessionEventTypes.ts) |
| `session.list.snapshot` | `snapshot` | `session` | [会话事件类型](../../Source/AgentSystem/Session/AgentSessionEventTypes.ts) |
| `session.history.started` | `snapshot` | `session` | [会话事件类型](../../Source/AgentSystem/Session/AgentSessionEventTypes.ts) |
| `session.history.chunk` | `snapshot` | `session` | [会话事件类型](../../Source/AgentSystem/Session/AgentSessionEventTypes.ts) |
| `session.history.steps` | `snapshot` | `session` | [会话事件类型](../../Source/AgentSystem/Session/AgentSessionEventTypes.ts) |
| `session.run_history.chunk` | `snapshot` | `session` | [会话事件类型](../../Source/AgentSystem/Session/AgentSessionEventTypes.ts) |
| `session.history.completed` | `snapshot` | `session` | [会话事件类型](../../Source/AgentSystem/Session/AgentSessionEventTypes.ts) |
| `session.truncated` | `snapshot` | `session` | [会话事件类型](../../Source/AgentSystem/Session/AgentSessionEventTypes.ts) |
| `session.forked` | `snapshot` | `session` | [会话事件类型](../../Source/AgentSystem/Session/AgentSessionEventTypes.ts) |
| `run.started` | `progress` | `run` | [运行事件类型](../../Source/AgentSystem/Events/AgentRunEventTypes.ts) |
| `run.activity.changed` | `progress` | `run` | [运行事件类型](../../Source/AgentSystem/Events/AgentRunEventTypes.ts) |
| `run.cancellation.progress` | `progress` | `run` | [运行事件类型](../../Source/AgentSystem/Events/AgentRunEventTypes.ts) |
| `prompt.summary` | `progress` | `prompt` | [提示词事件类型](../../Source/AgentSystem/Events/AgentPromptEventTypes.ts) |
| `action.planner.stage.started` | `progress` | `decision` | [规划事件类型](../../Source/AgentSystem/Events/AgentPlannerEventTypes.ts) |
| `action.planner.stage.completed` | `progress` | `decision` | [规划事件类型](../../Source/AgentSystem/Events/AgentPlannerEventTypes.ts) |
| `action.planner.stage.failed` | `error` | `decision` | [规划事件类型](../../Source/AgentSystem/Events/AgentPlannerEventTypes.ts) |
| `interaction.routed` | `progress` | `decision` | [规划事件类型](../../Source/AgentSystem/Events/AgentPlannerEventTypes.ts) |
| `action.planned` | `progress` | `decision` | [规划事件类型](../../Source/AgentSystem/Events/AgentPlannerEventTypes.ts) |
| `model.started` | `progress` | `model` | [模型事件类型](../../Source/AgentSystem/Events/AgentModelEventTypes.ts) |
| `model.delta` | `progress` | `model` | [模型事件类型](../../Source/AgentSystem/Events/AgentModelEventTypes.ts) |
| `model.completed` | `snapshot` | `model` | [模型事件类型](../../Source/AgentSystem/Events/AgentModelEventTypes.ts) |
| `tool.calls.planned` | `progress` | `tool` | [工具事件类型](../../Source/AgentSystem/ToolRuntime/AgentToolEventTypes.ts) |
| `tool.call.started` | `progress` | `tool` | [工具事件类型](../../Source/AgentSystem/ToolRuntime/AgentToolEventTypes.ts) |
| `tool.call.output` | `progress` | `tool` | [工具事件类型](../../Source/AgentSystem/ToolRuntime/AgentToolEventTypes.ts) |
| `tool.call.progress` | `progress` | `tool` | [工具事件类型](../../Source/AgentSystem/ToolRuntime/AgentToolEventTypes.ts) |
| `tool.call.completed` | `progress` | `tool` | [工具事件类型](../../Source/AgentSystem/ToolRuntime/AgentToolEventTypes.ts) |
| `tool.call.failed` | `error` | `tool` | [工具事件类型](../../Source/AgentSystem/ToolRuntime/AgentToolEventTypes.ts) |
| `tool.call.result.detail` | `snapshot` | `tool` | [工具事件类型](../../Source/AgentSystem/ToolRuntime/AgentToolEventTypes.ts) |
| `assistant.message.created` | `progress` | `run` | [运行事件类型](../../Source/AgentSystem/Events/AgentRunEventTypes.ts) |
| `approval.requested` | `progress` | `approval` | [审批事件类型](../../Source/AgentSystem/Approvals/AgentApprovalEventTypes.ts) |
| `approval.resolved` | `progress` | `approval` | [审批事件类型](../../Source/AgentSystem/Approvals/AgentApprovalEventTypes.ts) |
| `interaction.input.requested` | `progress` | `tool` | [交互输入事件类型](../../Source/AgentSystem/Interaction/AgentInteractionInputEventTypes.ts) |
| `interaction.input.resolved` | `progress` | `tool` | [交互输入事件类型](../../Source/AgentSystem/Interaction/AgentInteractionInputEventTypes.ts) |
| `execution.resource.created` | `snapshot` | `tool` | [工具事件类型](../../Source/AgentSystem/ToolRuntime/AgentToolEventTypes.ts) |
| `execution.resource.output` | `progress` | `tool` | [工具事件类型](../../Source/AgentSystem/ToolRuntime/AgentToolEventTypes.ts) |
| `execution.resource.resized` | `snapshot` | `tool` | [工具事件类型](../../Source/AgentSystem/ToolRuntime/AgentToolEventTypes.ts) |
| `execution.resource.state` | `snapshot` | `tool` | [工具事件类型](../../Source/AgentSystem/ToolRuntime/AgentToolEventTypes.ts) |
| `execution.resource.removed` | `snapshot` | `tool` | [工具事件类型](../../Source/AgentSystem/ToolRuntime/AgentToolEventTypes.ts) |
| `execution.resource.snapshot` | `snapshot` | `tool` | [工具事件类型](../../Source/AgentSystem/ToolRuntime/AgentToolEventTypes.ts) |
| `sandbox.status.snapshot` | `snapshot` | `sandbox` | [沙箱事件类型](../../Source/AgentSystem/Sandbox/AgentSandboxEventTypes.ts) |
| `run.completed` | `terminal` | `run` | [运行事件类型](../../Source/AgentSystem/Events/AgentRunEventTypes.ts) |
| `run.failed` | `error` | `run` | [运行事件类型](../../Source/AgentSystem/Events/AgentRunEventTypes.ts) |
| `run.cancelled` | `terminal` | `run` | [运行事件类型](../../Source/AgentSystem/Events/AgentRunEventTypes.ts) |
| `request.invalid` | `error` | `request` | [运行事件类型](../../Source/AgentSystem/Events/AgentRunEventTypes.ts) |
| `config.reloaded` | `snapshot` | `config` | [配置事件类型](../../Source/AgentSystem/Config/AgentConfigEventTypes.ts) |
| `config.failed` | `error` | `config` | [配置事件类型](../../Source/AgentSystem/Config/AgentConfigEventTypes.ts) |
| `config.snapshot` | `snapshot` | `config` | [配置事件类型](../../Source/AgentSystem/Config/AgentConfigEventTypes.ts) |
| `model.list.snapshot` | `snapshot` | `config` | [配置事件类型](../../Source/AgentSystem/Config/AgentConfigEventTypes.ts) |
| `provider.models.snapshot` | `snapshot` | `config` | [配置事件类型](../../Source/AgentSystem/Config/AgentConfigEventTypes.ts) |
| `provider.models.failed` | `error` | `config` | [配置事件类型](../../Source/AgentSystem/Config/AgentConfigEventTypes.ts) |
| `plugin.config.snapshot` | `snapshot` | `config` | [配置事件类型](../../Source/AgentSystem/Config/AgentConfigEventTypes.ts) |
| `profile.snapshot` | `snapshot` | `config` | [配置事件类型](../../Source/AgentSystem/Config/AgentConfigEventTypes.ts) |
| `preset.snapshot` | `snapshot` | `config` | [配置事件类型](../../Source/AgentSystem/Config/AgentConfigEventTypes.ts) |
| `preset.failed` | `error` | `config` | [配置事件类型](../../Source/AgentSystem/Config/AgentConfigEventTypes.ts) |

## 会话回放与恢复

1. 连接建立后发送 `session.list`，发现服务端拥有的会话。
2. 对当前会话发送 `session.history`。一次回放会依次产生 `session.history.started`、零到多个 history chunk、可选的 step/run-history chunk，最后是 `session.history.completed`。
3. 连接替换或本地状态过期时，使用 `refresh: true` 再次请求历史；不要把 `sequence` 当成可持久化游标。
4. 将 `session.not_found` 视为服务端权威删除；将 `run.failed` 和 `request.invalid` 视为错误，而不是成功终态。

## 兼容性规则

- 保留服务端 event envelope 和 payload 中的未知字段；新版本服务端可能增加可选数据。
- 拒绝未知客户端请求字段。请求 schema 有意采用 strict 模式。
- 不要从 `model.delta` 推断最终回答；等待 `assistant.message.created` 的 `terminal: true` 以及 run 终态事件。
- 将 `tool.call.result.detail` 视为可选详情数据。面向用户的工具终态由 `tool.call.completed` 或 `tool.call.failed` 表达。
