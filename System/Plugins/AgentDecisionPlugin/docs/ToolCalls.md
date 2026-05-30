# ToolCalls

## 简述

请求 senera 执行一个或多个已注册工具。

## 协议位置

`<senera_tool_calls>` 是当前协议唯一的工具控制根标签。历史消息和工具结果会作为只读证据提供，只能读取其中事实，不能复制上下文包装结构。

## 何时使用

当用户任务需要外部实时信息、工作区观察、确定性计算、插件能力或需要执行工具才能完成时使用。输出 `<senera_tool_calls>` 后，本轮不要同时输出最终回答。

## 不要使用的情况

不要为了普通常识、简单解释或已经有足够上下文的问题调用工具。不要编造未注册工具名，也不要在同一条回复里拼接自然语言最终回答。

## 输出

根标签必须是 `<senera_tool_calls>`。每个工具调用使用一个 `<tool_call>`，里面必须包含 `<name>`，参数必须放在 `<arguments>` 内。不要输出 `<call_id>`、`<runtime>` 或任何运行时元数据；这些字段由 senera runtime 在执行后自动补充到工具结果上下文中。

## 调用示例

<senera_tool_calls>
  <tool_call>
    <name>WeatherTool</name>
    <arguments>
      <location>Beijing</location>
      <temperatureUnit>celsius</temperatureUnit>
    </arguments>
  </tool_call>
</senera_tool_calls>

## 执行约束

工具参数字段必须匹配对应工具的 `arguments_contract`；其中 XML 结构是主约束，TS-like 预览只用于速览字段形状；数组字段用重复 `<item>` 标签表达。对象字段和数组容器保持标签结构，叶子值字段直接写文本。工具执行成功后，下一轮会收到只读工具结果证据；你可以继续调用工具，或直接用自然语言回复用户。运行时关联字段由系统维护，不要主动生成。
整条回复必须直接从 `<senera_tool_calls>` 开始，不能先写分析、解释、确认句或 Markdown；真实工具调用不能用任何代码围栏包裹。
