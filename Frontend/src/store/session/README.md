# Session Store 模块导览

Session store 负责把后端事件投影成前端会话、消息、运行状态和时间线。

## 阅读顺序

1. `types.ts`：前端 session 状态结构。
2. `defaults.ts`：初始状态和默认值。
3. `sessionProjector.ts`：事件投影入口，只做跨域分发和 session 边界事件。
4. `runEventProjector.ts`：运行事件聚合入口。
5. `runLifecycleProjector.ts`：run started / completed / failed / busy / cancelled。
6. `runDecisionProjector.ts`：Prompt、规划、决策解析相关时间线。
7. `runModelStreamProjector.ts`：模型调用、流式文本和 XML progress。
8. `runToolAndAnswerProjector.ts`：实时工具事件入口、最终回复和追问；`toolCallProjection.ts` 统一合并实时、子任务和历史详情中的工具参数、状态、结果与耗时。
9. `scopedRunProjector.ts`：子代理 / merge scope 事件投影到父 run。
10. `sessionHistoryProjector.ts`、`historyRunProjection.ts`：历史加载和历史 run 重建。
11. `sessionListProjection.ts`：会话列表快照、active session 和删除状态。
12. `sessionRunProjection.ts`：流式文本与运行期展示状态；传输层每帧合并后直接投影，避免重复的字符级展示循环。
13. `persistence.ts`：本地持久化和迁移。
14. `userProfile.ts`：用户资料状态。

## 扩展规则

- 新事件先更新 API 类型，再进入对应事件域 projector。
- 不把具体事件细节加回 `sessionProjector.ts`；它只保留入口分发和 session 边界事件。
- 新 run 事件优先注册到 `runLifecycleProjector.ts`、`runDecisionProjector.ts`、`runModelStreamProjector.ts` 或 `runToolAndAnswerProjector.ts`。
- UI 组件不直接拼后端事件逻辑，先进入 session state。
- 工具事件统一进入 `projectToolCallEvent`，按调用标识合并；新增事件处理不得在实时、子任务、历史入口各维护一份。结果正文、执行结局和历史可用性分别保留，缺失记录不能伪造成空对象或成功结果。
- 大块 projector 逻辑按 message、run、tool call、timeline、selection 拆分，避免单文件重新超过 500 行。
- 投影行为要优先补 store 或 projector 测试。
- shared UI 不依赖 session 领域类型。
- 工作区偏好在空闲时合并保存；切换工作区、页面隐藏或关闭时刷新待保存状态，不能在每次切换会话或运行状态更新时同步序列化整个工作区。
