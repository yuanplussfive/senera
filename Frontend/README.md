# senera Frontend

senera 后端 WebSocket 服务的三栏式 Web 界面。

## 启动

先启动后端：

```bash
# 在仓库根目录
npm run server     # 默认监听 ws://127.0.0.1:8787
```

再启动前端：

```bash
# 在 Frontend/ 目录
npm install        # 仅第一次需要
npm run dev        # 默认 http://127.0.0.1:5173
```

打开浏览器即可。前端会自动建一个空会话并连后端。

## 配置

前端默认读取仓库根目录的 `senera.config.json`，配置入口是 `Defaults.Frontend` 或顶层 `Frontend`。顶层配置会覆盖 `Defaults.Frontend`。

| 字段 | 默认 | 含义 |
|---|---|---|
| `Frontend.DevServer.Host` | `127.0.0.1` | Vite dev host |
| `Frontend.DevServer.Port` | `5173` | Vite dev 端口 |
| `Frontend.DevServer.StrictPort` | `false` | dev 端口被占用时允许 Vite 自动切换到下一个可用端口 |
| `Frontend.PreviewServer.Port` | `4173` | Vite preview 端口 |
| `Frontend.Client.WebSocketUrl` | 根据 `Server.Host`/`Server.Port` 推导 | 浏览器连接后端的 WS 地址 |
| `Frontend.Client.EmptySuggestions` | 内置三条建议 | 启动空状态建议 |

## 目录

```
src/
  api/
    eventTypes.ts         协议 DTO；事件枚举从 generatedEventCatalog.ts 引入
    generatedEventCatalog.ts 后端事件 catalog 生成物
    useAgentSocket.ts     WS 连接 / 自动重连 hook
  store/
    sessionStore.ts       Zustand store + 事件→状态投影
  features/
    session/              左栏：会话列表、用户资料和会话操作
    chat/                 中栏：对话消息、输入框、配置面板和审批条
    workflow/             右栏：思考过程时间线、工具节点和详情抽屉
  shared/
    ui/                   无业务语义的 UI primitives
    code/                 Markdown / code 渲染能力
  layout/
    AppShell.tsx          三栏响应式布局
  lib/util.ts             小工具
  App.tsx                 顶层组装
```

## 三栏映射的事件源

| 区域 | 数据来源（后端事件） |
|---|---|
| 左栏会话标题 | 首条用户消息客户端截取 24 字 |
| 中栏用户气泡 | 本地立即渲染 |
| 中栏助手气泡 | `assistant.message.created` |
| 中栏"正在生成" | `model.delta` 流式占位 |
| 右栏卡片 | `run.started` / `prompt.summary` / `model.*` / `pi.trace` / `tool.*` / `assistant.message.created` |
| 右栏 callId 关联 | `tool.call.started.callId` ↔ `tool.call.result.detail.callId` |

## 协议同步

后端事件枚举以 `Source/AgentSystem/Events/AgentEventCatalog.ts` 为单源。修改事件枚举后运行 `npm run generatefrontendevents`，CI 会校验生成物是否过期；事件 data DTO 仍保留在 `src/api/eventTypes.ts`，只表达前端实际读取的字段。
