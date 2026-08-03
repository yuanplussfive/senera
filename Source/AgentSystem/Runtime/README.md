# Runtime 模块

`Runtime` 是 Agent 系统的装配层，负责把配置、System Tools、MCP packages、Skills、模型、规划器、工具执行和运行时服务组装成一次可运行的系统实例。

## 模块职责

- `AgentSystemRuntime`：管理实例生命周期，并通过稳定 getter 暴露主循环需要的服务和组件。
- `AgentSystemRuntimeComposition`：分阶段装配基础设施与 Agent 服务，是完整运行时的唯一组合入口。
- `AgentRuntimeServices`：定义主循环调用的服务契约，隔离具体实现。
- `AgentRuntimeModule`：允许模块按服务契约替换或扩展运行时能力。
- `AgentPiProxyModelAdapter`：在组合层连接 PiProxy 端口与 ActionPlanner 模型实现，避免两个领域互相了解实现细节。

## 边界规则

- Runtime 可以装配各领域模块，但不承载具体业务算法。
- 新能力优先落在对应领域目录，再通过 Runtime 注册或注入。
- `AgentSystemRuntime` 构造函数只接收类型化组合选项；新增依赖应进入对应装配阶段，不能恢复位置参数列表。
- 跨领域实现依赖放在 Runtime 适配器中；PiProxy 只声明端口，不直接导入 ActionPlanner。
- 主循环只依赖 `services` 契约和必要的运行时只读配置，避免直接知道所有实现细节。
