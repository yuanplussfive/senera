# Events 模块

`Events` 只定义执行期事件的类型契约，不负责事件发送、持久化或 UI 展示。

## 模块职责

- `AgentExecutionEventTypes`：执行期事件 union 出口。
- `AgentRunEventTypes`：请求开始、终态、失败、取消和无效请求事件。
- `AgentPromptEventTypes`：提示词明细和摘要事件。
- `AgentPlannerEventTypes`：Action Planner 阶段、路由和规划结果事件。
- `AgentModelEventTypes`：模型请求、流式输出和完成事件。
- `AgentExecutionEventSharedTypes`：多个事件域共享的投影类型。

## 边界规则

- 事件类型按业务域拆分，根目录 `AgentExecutionEventTypes` 只保留兼容出口。
- 事件数据应是稳定投影，不直接暴露大型运行时对象。
- 新增事件时先在对应领域文件补类型，再在事件目录出口 union 中组合。

