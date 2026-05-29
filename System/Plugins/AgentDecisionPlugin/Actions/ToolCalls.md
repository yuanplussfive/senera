# ToolCalls

## 简述

请求 senera 执行一个或多个已注册工具。

## 协议位置

`<tool_calls>` 是当前协议唯一的工具控制根标签。历史里的用户消息会以上下文标签 `<context_user_message><content>...</content></context_user_message>` 提供；工具执行完成后，系统内部会先生成运行时结果 `<tool_results>`，再把它包装成历史上下文 `<context_tool_results>` 提供给下一轮模型。`<context_user_message>` 和 `<context_tool_results>` 都属于历史转录，不是你这一轮应该输出的根标签。

## 何时使用

当用户任务需要外部实时信息、工作区观察、确定性计算、插件能力或需要执行工具才能完成时使用。输出 `<tool_calls>` 后，本轮不要同时输出最终回答。

## 不要使用的情况

不要为了普通常识、简单解释或已经有足够上下文的问题调用工具。不要编造未注册工具名，也不要在同一条回复里拼接自然语言最终回答。

## 输出

根标签必须是 `<tool_calls>`。每个工具调用使用一个 `<tool_call>`，里面必须包含 `<name>`，参数必须放在 `<arguments>` 内。不要输出 `<call_id>`、`<runtime>` 或任何运行时元数据；这些字段由 senera runtime 在执行后自动补充到工具结果上下文中。

## 调用示例

```xml
<tool_calls>
  <tool_call>
    <name>WeatherTool</name>
    <arguments>
      <location>Beijing</location>
      <temperatureUnit>celsius</temperatureUnit>
    </arguments>
  </tool_call>
</tool_calls>
```

## 执行约束

工具参数字段必须匹配对应工具的 `arguments_contract`；其中 XML 结构是主约束，TS-like 预览只用于速览字段形状；数组字段用重复 `<item>` 标签表达。对象字段和数组容器保持标签结构，叶子值字段直接写文本。工具执行成功后，系统内部会生成 `<tool_results>`，而你在后续历史上下文里看到的是 `<context_tool_results>`；其中 `<context_tool_results>` 内部承载一个或多个 `<tool_result>`，并可能包含 `<runtime><call_id>call_1a2b3c4d</call_id></runtime>` 这样的运行时关联信息。`call_id` 只用于标记某次已经执行过的工具调用，不是你下一轮应该主动生成的字段。看到这些工具结果上下文后，下一轮可以继续调用工具，或直接用自然语言回复用户。
整条回复必须直接从 `<tool_calls>` 开始，不能先写分析、解释、确认句或 Markdown。
