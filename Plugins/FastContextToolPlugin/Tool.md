# FastContextTool

## 简述

搜索、读取本地工作区代码、配置和文档片段。

## 何时使用

定位实现、配置、错误码、插件声明、文档或相关上下文时使用。

## 不要使用的情况

不要用于联网、执行命令或修改文件。最新外部事实用搜索工具。

## 配置

读取插件目录 `PluginConfig.toml`，可配置 roots、exclude、扩展名、文件大小、默认结果数和 `.state`。

## 输入

`FastContextSearchTool`：`query` 必填，可选 roots、扩展名、maxResults、contextLines、regex。

`FastContextReadTool`：按 `path` 读取，可选 startLine、endLine、maxChars。

`FastContextRefreshIndexTool`：刷新本地索引。

`FastContextWorkspaceMapTool`：查看可搜索根和目录概览；不确定目录时先用它。

## 输出

搜索返回路径、行号、片段、分数、warnings 和 availableRoots。读取返回内容、行号、总行数和截断信息。

## 调用示例

```xml
<tool_calls>
  <tool_call>
    <name>FastContextSearchTool</name>
    <arguments>
      <query>AgentDecisionXmlCollector</query>
      <maxResults>8</maxResults>
    </arguments>
  </tool_call>
</tool_calls>
```

```xml
<tool_calls>
  <tool_call>
    <name>FastContextReadTool</name>
    <arguments>
      <path>Source/example.ts</path>
      <startLine>80</startLine>
      <endLine>180</endLine>
    </arguments>
  </tool_call>
</tool_calls>
```

## 执行约束

只读允许范围内文本文件。搜索结果不是完整事实，修改前继续读取确认。
