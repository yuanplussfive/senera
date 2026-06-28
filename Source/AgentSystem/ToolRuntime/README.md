# ToolRuntime 模块

`ToolRuntime` 负责工具运行时协议、工具执行、宿主能力调用、插件进程封装、工具 catalog 投影和工具观察结果投影。

## 模块职责

- `AgentToolRunner`：根据工具 handler 类型调度插件进程或宿主能力。
- `AgentToolProcessRunner` / `AgentToolProcessEnvelope`：封装工具进程输入输出、结构化成功/失败响应和进程错误。
- `AgentToolProcessEntryResolver` / `AgentToolProcessSession` / `AgentToolProcessResponseParser`：分别负责插件入口解析、子进程生命周期和 stdout envelope 解析。
- `AgentToolProcessTypes` / `AgentToolProcessResultFactory`：进程运行类型和失败结果构造。
- `AgentToolHostCapabilityRegistry`：注册和查找系统宿主能力。
- `ToolPluginRuntime` / `AgentToolPluginSdk`：给外部工具插件提供结构化运行入口。
- `AgentToolCatalogProjector` / `AgentToolTagCatalogProjector`：把注册工具投影成模型和 UI 可读目录。
- `AgentToolObservationProjection` / `AgentToolObservationRenderer`：把工具调用和工具结果投影成 planner timeline 可读观察。

## 边界规则

- ToolRuntime 不负责工具搜索排序；搜索和学习属于 `ToolSearch`。
- ToolRuntime 不负责规划要调用哪些工具；工具调用规划属于 `ActionPlanner`。
- 工具执行产物的落盘策略属于 `Artifacts`，ToolRuntime 只产生结构化运行结果。
