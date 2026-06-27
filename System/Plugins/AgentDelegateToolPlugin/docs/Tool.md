# AgentDelegateTool

## 简述
根据已注册的 workflow 声明生成子代理委派计划；当 `executionMode` 为 `run` 时，启动子代理循环并执行 merge。

## 何时使用
当 active skill 推荐了 workflow，或者用户明确要求“子代理”“并行审查”“分工调查”“多角色分析”时使用。把推荐 workflow 名传入 `workflow`，并把当前目标、可见 evidence refs、artifact URIs 一起交给工具。用户只想确认拆分方案时使用 `executionMode=plan`；用户要求实际分工处理时使用 `executionMode=run`。

## 不要使用的情况
只需要普通工具一步取证、直接回答或用户没有要求分工时不要使用。不要猜 workflow 名；优先使用 active skill 的 `recommended_workflows`。

## 输入
- `workflow`：已注册 workflow 名。
- `objective`：可选，本轮要达成的目标。
- `executionMode`：`plan` 只生成计划；`run` 执行子代理 loop 并按 merge policy 合并结果。
- `evidenceUris.item`：可选，当前轮已可见的证据引用。
- `artifactUris.item`：可选，当前轮已可见的 artifact URI。

## 输出
返回一个可落地的 delegation plan：workflow 元信息、调度策略、每个 job 的 agent、task 文件、context pack、推荐工具、runtime profile、输出 schema 和 merge policy。`executionMode=run` 时，返回中还包含 `run`，其中有 child job 结果和 merge 结果；`execution.mode` 为 `agentLoop`。

## 调用示例
<senera_tool_calls>
  <tool_call>
    <name>AgentDelegateTool</name>
    <arguments>
      <workflow>ParallelPullRequestReview</workflow>
      <objective>并行审查当前 PR 的安全、测试缺口和可维护性风险。</objective>
      <executionMode>run</executionMode>
    </arguments>
  </tool_call>
</senera_tool_calls>

## 执行约束
`executionMode=plan` 只读取插件声明和当前请求参数。`executionMode=run` 会按 workflow 的 `Execution` 调度策略顺序或并发执行 child jobs，按子代理 runtime profile 调用配置的模型供应商，并把每个 child job 限定在 workflow 声明的推荐工具范围内；取消信号会传递到子代理 loop。
