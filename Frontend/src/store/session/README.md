# Session Store 模块导览

Session store 负责把后端事件投影成前端会话、消息、运行状态和时间线。

## 阅读顺序

1. `types.ts`：前端 session 状态结构。
2. `defaults.ts`：初始状态和默认值。
3. `sessionProjector.ts`：后端事件到 session state 的主投影。
4. `streamingDisplay.ts`：流式文本展示状态。
5. `persistence.ts`：本地持久化和迁移。
6. `userProfile.ts`：用户资料状态。

## 扩展规则

- 新事件先更新 API 类型，再更新 projector。
- UI 组件不直接拼后端事件逻辑，先进入 session state。
- 大块 projector 逻辑按 message、run、tool call、timeline、selection 拆分。
- 投影行为要优先补 store 或 projector 测试。
- shared UI 不依赖 session 领域类型。

