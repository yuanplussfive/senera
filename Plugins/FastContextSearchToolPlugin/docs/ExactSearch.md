# FastContextSearchTool

## 简述

用 ripgrep 做本地精确文本、路径片段或正则搜索。

## 何时使用

已知明确字符串、错误码、配置键、日志片段、XML 标签、CSS 类名、文件名片段或需要正则匹配时使用。适合“搜索 InvalidXmlEnvelope”“查 <senera_tool_calls> 出现位置”。

## 不要使用的情况

问题抽象、关键词不确定或需要多策略召回时用 `FastContextHybridSearchTool`。找函数/类型/组件定义时用 `FastContextSymbolSearchTool`。读取文件内容用 `FastContextReadTool`。

## 配置

读取 `PluginConfig.toml` 的 roots、exclude、默认结果数、上下文行数、文件大小限制和 ripgrep 超时设置。

## 输入

`query` 必填。可选 `regex`、`caseSensitive`、`roots`、`exclude`、`maxResults`、`contextLines`。不确定目录时省略 `roots`。

## 输出

返回精确命中的 path、line、snippet、score、focus、warnings 和 availableRoots。`focus` 来自 ripgrep submatches，表示命中行里的关键片段。

## 调用示例

<senera_tool_calls>
  <tool_call>
    <name>FastContextSearchTool</name>
    <arguments>
      <query>InvalidXmlEnvelope</query>
      <maxResults>12</maxResults>
      <contextLines>2</contextLines>
    </arguments>
  </tool_call>
</senera_tool_calls>

## 执行约束

只读工作区并调用 ripgrep。不要猜不存在的 roots；搜索不到时先用更短关键词或 `FastContextWorkspaceMapTool` 确认目录。
