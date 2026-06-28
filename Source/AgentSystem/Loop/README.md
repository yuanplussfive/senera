# Loop 模块

`Loop` 是一次请求进入 Agent 后的主循环边界，负责把路由、规划、提示词渲染、模型输出收集、工具执行和完成判断串成确定性的状态机流程。

## 模块职责

- `AgentLoop`：主循环入口，启动状态机并顺序执行状态机命令。
- `AgentLoopStateMachine`：状态机公开入口，只负责启动和消费命令结果。
- `AgentLoopInitialState`：构造请求初始 running state。
- `AgentLoopTransitionReducer`：按命令结果生成下一状态、下一命令和事件。
- `AgentLoopSuccessTransitionHandler`：处理成功命令结果的状态转移分支，保持 reducer 主体只负责失败、步进和公共收口。
- `AgentLoopStateTypes`：集中定义状态机状态、命令、命令结果和 transition 契约。
- `AgentLoopCommandBuilder`：从 running state 派生下一条命令，避免状态机内重复拼装命令对象。
- `AgentLoopCommandExecutor`：把状态机命令分发给规划、工具调用规划、XML 收集和执行处理器。
- `AgentLoopEventFactory`：循环事件门面，保持调用点稳定。
- `AgentLoopRunEventFactory` / `AgentLoopPromptEventFactory` / `AgentLoopPlannerEventFactory` / `AgentLoopDecisionEventFactory` / `AgentLoopToolEventFactory`：按事件领域生成具体事件。
- `AgentLoopEventProjection`：把规划、理解和完成判断对象投影成稳定事件数据。
- `AgentCompletionGate`：完成判断入口，只编排进度、证据需求和工具建议。
- `AgentCompletionGateTypes`：完成判断的公共类型契约。
- `AgentCompletionEvidence`：任务需求收集、证据引用校验和 requirement 状态归一。
- `AgentCompletionProgress`：从 run state 投影重复调用、失败调用和无证据调用。
- `AgentCompletionToolRecommendation`：根据候选工具和能力索引生成工具调用/发现建议。

## 边界规则

- Loop 可以调度 `ActionPlanner`、执行器和运行时服务，但不拥有具体工具、模型端点或记忆存储实现。
- 状态机只接收结构化输入和命令结果，不读取数据库、文件系统或网络。
- 新增循环阶段时，先扩展状态机命令和命令执行器，再补齐事件投影与验证脚本。
