# AskUserTool

## 简述

向用户提一个必要问题，并暂停等待回复。

## 何时使用

缺少必要信息，且无法从上下文或工具可靠推断时使用。

## 不要使用的情况

能合理默认或直接回答时不要调用；需要执行能力时调用对应工具。

## 输入

`question` 必填。`reason_code` 可选，例如 `missing_location`。

## 输出

返回 `AskUser` 控制结果，宿主暂停运行。

## 调用示例

<senera_tool_calls>
  <tool_call>
    <name>AskUserTool</name>
    <arguments>
      <question>你想对比什么内容？</question>
      <reason_code>missing_scope</reason_code>
    </arguments>
  </tool_call>
</senera_tool_calls>

## 执行约束

必须单独调用，不能与其它工具混用。
