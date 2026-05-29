# senera Frontend

senera 后端 WebSocket 服务的三栏式 Web 界面。

## 启动

先启动后端：

```bash
# 在仓库根目录
npm run server     # 监听 ws://127.0.0.1:8787
```

再启动前端：

```bash
# 在 Frontend/ 目录
npm install        # 仅第一次需要
npm run dev        # http://127.0.0.1:5173
```

打开浏览器即可。前端会自动建一个空会话并连后端。

## 环境变量

复制 `.env.example` 为 `.env.local` 后可覆盖：

| 变量 | 默认 | 含义 |
|---|---|---|
| `VITE_WS_URL` | `ws://127.0.0.1:8787` | 后端 WS 地址 |
| `VITE_MODEL_LABEL` | `senera · gpt-5.5` | 输入框右下角显示的模型名 |
| `VITE_USER_NAME` | `you` | 左下角用户名 |

## 目录

```
src/
  api/
    eventTypes.ts         协议类型（与后端 AgentEvent.ts 同步）
    useAgentSocket.ts     WS 连接 / 自动重连 hook
  store/
    sessionStore.ts       Zustand store + 事件→状态投影
  components/
    SessionList.tsx       左栏：会话列表
    ChatPanel.tsx         中栏：对话气泡 + 输入框
    ThinkingTimeline.tsx  右栏：思考过程时间线
  lib/util.ts             小工具
  App.tsx                 顶层组装
```

## 三栏映射的事件源

| 区域 | 数据来源（后端事件） |
|---|---|
| 左栏会话标题 | 首条用户消息客户端截取 24 字 |
| 中栏用户气泡 | 本地立即渲染 |
| 中栏助手气泡 | `final.answer` / `ask.user` |
| 中栏"正在生成" | `model.delta` 流式占位 |
| 右栏卡片 | `run.started` / `prompt.summary` / `model.*` / `decision.*` / `tool.*` / `retry.planned` / `final.answer` |
| 右栏 callId 关联 | `tool.call.started.callId` ↔ `tool.results.detail.value[].callId` |

## 协议同步

后端 `Source/AgentSystem/AgentEvent.ts` 修改后，需手动同步 `src/api/eventTypes.ts` 中的 `EventKinds` 与各 `*Data` 接口。
