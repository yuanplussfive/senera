# FastContextTool

## 简述

兼容聚合版本地上下文工具，包含搜索、读取、刷新索引和工作区地图能力。

## 何时使用

只在系统仍加载旧聚合工具包，或需要一个工具包内同时使用旧的 `FastContextSearchTool`、`FastContextReadTool`、`FastContextRefreshIndexTool`、`FastContextWorkspaceMapTool` 时使用。

## 不要使用的情况

优先使用拆分后的独立工具：定位代码用 `FastContextHybridSearchTool`，读取路径用 `FastContextReadTool`，查看目录用 `FastContextWorkspaceMapTool`，刷新索引用 `FastContextRefreshIndexTool`。不要用于联网、执行命令或修改文件。

## 配置

读取插件目录 `PluginConfig.toml`，可配置 roots、exclude、扩展名、文件大小、默认结果数和 `.state`。

## 输入

`FastContextSearchTool`：旧聚合搜索入口，`query` 必填，可选 roots、扩展名、maxResults、contextLines、regex。

`FastContextReadTool`：旧聚合读取入口，按 `path` 读取，可选 startLine、endLine、maxChars。

`FastContextRefreshIndexTool`：刷新本地索引。

`FastContextWorkspaceMapTool`：查看可搜索根和目录概览；不确定目录时先用它。

## 输出

搜索返回路径、行号、片段、分数、warnings 和 availableRoots。读取返回内容、行号、总行数和截断信息。

## 调用示例

<senera_tool_calls>
  <tool_call>
    <name>FastContextSearchTool</name>
    <arguments>
      <query>AgentDecisionXmlCollector</query>
      <maxResults>8</maxResults>
    </arguments>
  </tool_call>
</senera_tool_calls>
<senera_tool_calls>
  <tool_call>
    <name>FastContextReadTool</name>
    <arguments>
      <path>Source/example.ts</path>
      <startLine>80</startLine>
      <endLine>180</endLine>
    </arguments>
  </tool_call>
</senera_tool_calls>

## 执行约束

只读允许范围内文本文件。搜索结果不是完整事实，修改前继续读取确认。
