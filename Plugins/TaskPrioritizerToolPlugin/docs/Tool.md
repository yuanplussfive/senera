# TaskPrioritizerTool

## 简述

按影响、紧急度、工作量和阻塞关系排序任务。

## 何时使用

用户给出待办、计划、缺陷池或发布清单，并需要优先级顺序时使用。

## 不要使用的情况

不要替代业务判断。没有明确任务列表时先追问。

## 输入

`strategy` 支持 `balanced`、`urgent_first`、`impact_first`。`focusMode` 可选。`tasks.item` 必填，含 title、impact、urgency、effort；dependencies、labels、blocked 可选。

## 输出

返回推荐顺序、评分、分组、阻塞任务、总工作量和高优先级数量。

## 调用示例

<senera_tool_calls>
  <tool_call>
    <name>TaskPrioritizerTool</name>
    <arguments>
      <strategy>balanced</strategy>
      <focusMode>minimize_switching</focusMode>
      <tasks>
        <item>
          <title>Fix login bug</title>
          <impact>5</impact>
          <urgency>5</urgency>
          <effort>2</effort>
          <blocked>false</blocked>
          <labels>
            <item>backend</item>
            <item>auth</item>
          </labels>
        </item>
      </tasks>
    </arguments>
  </tool_call>
</senera_tool_calls>

## 执行约束

评分为 1-5 整数。dependencies 只能引用输入任务标题。数组用重复 `<item>`。
