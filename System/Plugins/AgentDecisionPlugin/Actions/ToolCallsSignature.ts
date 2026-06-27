export type ToolCallsDecision = {
  // 工具调用数组。XML 写法：重复 <tool_call> 标签。
  tool_call: Array<{
    // 已注册工具名，必须和 <tools> 中的 <name> 完全一致。
    name: string

    // 工具参数容器。字段名必须来自对应工具的 arguments_contract。
    arguments?: {
      [name: string]: unknown
    }

    // 不要输出 call_id。它是运行时自动生成的关联标识，只会出现在工具结果上下文里。
  }>
}
