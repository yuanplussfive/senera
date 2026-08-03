# WebSocket 模块导览

WebSocket 模块负责后端和前端/终端的实时通信入口。它只处理传输协议、请求分发和事件发送，不直接实现 agent loop、配置存储、工具运行或预设解析。

## 阅读顺序

1. `AgentWebSocketServer.ts`：HTTP/WS 服务生命周期、端口监听、连接接入和广播入口。
2. `AgentWebSocketProtocol.ts`：前端发送到后端的请求 schema 和请求 union 类型。
3. `AgentWebSocketMessageRouter.ts`：单条 WS 消息解析、结构校验、dispatch 和统一失败事件投影。
4. `AgentWebSocketRequestHandlers.ts`：稳定聚合导出，不承载请求实现。Session、ExecutionResource、Config、Settings、Interaction 和 Sandbox handler 分别位于同名领域文件。
5. `AgentWebSocketEventSender.ts`：事件 envelope 编号、发送和运行事件持久化。
6. `AgentWebSocketHttpRouter.ts`：同端口 HTTP 请求入口，统一执行认证后再分发上传和 Pi Proxy API。
7. `../Auth/AgentServerAccessGuard.ts`：HTTP/WS 入口认证、Origin、连接配额、限流和心跳策略。
8. `AgentWebSocketRequestFailures.ts`：把请求处理异常投影成前端可消费的事件。

## 扩展规则

- 新增 WS 请求时先扩展 `AgentWebSocketProtocol.ts`，再在 `AgentWebSocketMessageRouter.ts` 补完整 dispatch。
- `AgentWebSocketMessageRouter` 直接依赖请求所属的领域 handler；聚合导出只用于稳定外部导入，禁止把业务实现重新写回 `AgentWebSocketRequestHandlers.ts`。
- 请求 handler 只能调用明确领域服务，不在 WebSocket 层读取数据库、扫描扩展目录或执行工具。
- 失败事件必须通过 `AgentWebSocketRequestFailures.ts` 统一投影，避免不同请求返回不一致的错误结构。
- 设置目录使用 `systemTool.list` 和 `mcpServer.list` 获取脱敏快照。System Extension 配置通过带 revision guard 的主 `config.update` 保存；MCP 输入通过 `mcpInput.update` 按服务原子批量保存，不能在 WebSocket handler 中逐字段写库。
- `mcpInput.update.requestId` 是前端操作关联标识。成功的 `mcp_server.snapshot.data.operation` 和失败的 `request.invalid.data.details.requestId` 必须原样返回；失败投影不得包含 `values`、`deletes` 或 Secret 内容。
- 新增 HTTP 入口时放入 `AgentWebSocketHttpRouter.ts`，明确其认证和 CSRF 语义，不要写在 server 生命周期类里。
- durable run event 先进入按 session 隔离的有界队列。`maxPendingEvents` 是包含 active batch 的硬容量；`backpressureAtEvents/resumeAtEvents` 是高低水位。达到高水位后 producer promise 必须等待，达到硬上限必须以 `queue_overflow` 明确失败，禁止继续 push 或静默丢弃。
- 空闲 persistence queue 必须自动从 sender registry 退休，避免进程内 Map 随历史 session 数增长；退休 queue 的 failure/overflow 计数必须并入累计健康快照。
- `pendingEvents` 必须统计等待写入和正在写入的 event。把 active batch 从数组移出不能让容量和健康指标暂时归零。
