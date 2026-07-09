# Loop 模块

`Loop` 是一次请求进入 Agent 后的外层编排边界，负责把请求理解、运行路由、提示词渲染、单次 Pi turn 和最终回复串成确定性的状态机流程。

## 模块职责

- `AgentLoop`：主循环入口，启动状态机并顺序执行状态机命令。
- `AgentLoopStateMachine`：状态机公开入口，只负责启动和消费命令结果。
- `AgentLoopInitialState`：构造请求初始 running state。
- `AgentLoopTransitionReducer`：按命令结果生成下一状态、下一命令和事件。
- `AgentLoopSuccessTransitionHandler`：处理成功命令结果的状态转移分支，保持 reducer 主体只负责命令结果分发。
- `AgentLoopStateTypes`：集中定义状态机状态、命令、命令结果和 transition 契约。
- `AgentLoopCommandBuilder`：从 running state 派生下一条命令，避免状态机内重复拼装命令对象。
- `AgentLoopCommandExecutor`：把状态机命令分发给请求理解、运行路由、提示词渲染和 Pi turn。
- `AgentLoopEventFactory`：循环事件门面，保持调用点稳定。
- `AgentLoopRunEventFactory` / `AgentLoopPromptEventFactory` / `AgentLoopPlannerEventFactory` / `AgentLoopToolEventFactory`：按事件领域生成具体事件。
- `AgentLoopEventProjection`：把规划、理解和 Pi 执行结果投影成稳定事件数据。

## 边界规则

- Loop 可以调度 `ActionPlanner`、执行器和运行时服务，但不拥有具体工具、模型端点或记忆存储实现。
- 状态机只接收结构化输入和命令结果，不读取数据库、文件系统或网络。
- Loop 不拥有多步工具预算或结构化输出修复预算；Pi 工具循环、并发、审批和预算约束由 Pi/runtime 层负责，planner/compiler 的修复次数由各自配置负责。
- 新增循环阶段时，先扩展状态机命令和命令执行器，再补齐事件投影与验证脚本。
