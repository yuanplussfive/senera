# WebSocket 模块导览

WebSocket 模块负责后端和前端/终端 的实时通信入口。它只处理传输协议、请求分发和事件发送，不直接实现 agent loop、配置存储、插件运行或预设解析。

## 阅读顺序

1. `AgentWebSocketServer.ts`：HTTP/WS 服务生命周期、端口监听、连接接入和广播入口。
2. `AgentWebSocketProtocol.ts`：前端发送到后端的请求 schema 和请求 union 类型。
3. `AgentWebSocketMessageRouter.ts`：单条 WS 消息解析、结构校验、dispatch 和统一失败事件投影。
4. `AgentWebSocketRequestHandlers.ts`：会话、配置、插件、预设、用户画像请求到领域服务的适配。
5. `AgentWebSocketEventSender.ts`：事件 envelope 编号、发送和运行事件持久化。
6. `AgentWebSocketHttpRouter.ts`：同端口 HTTP 请求入口，目前承载上传 API。
7. `AgentWebSocketRequestFailures.ts`：把请求处理异常投影成前端可消费的事件。

## 扩展规则

- 新增 WS 请求时先扩展 `AgentWebSocketProtocol.ts`，再在 `AgentWebSocketMessageRouter.ts` 补完整 dispatch。
- 请求 handler 只能调用明确领域服务，不在 WebSocket 层读取数据库、扫描插件目录或执行工具。
- 失败事件必须通过 `AgentWebSocketRequestFailures.ts` 统一投影，避免不同请求返回不一致的错误结构。
- 新增 HTTP 入口时放入 `AgentWebSocketHttpRouter.ts`，不要写在 server 生命周期类里。
