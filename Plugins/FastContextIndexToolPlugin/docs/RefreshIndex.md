# FastContextRefreshIndexTool

## 简述

刷新或强制重建本地全文/符号索引。

## 何时使用

代码刚大量变更、索引过期、首次使用索引搜索、搜索结果明显缺失，或用户明确要求“刷新索引/重建索引/预热索引”时使用。

## 不要使用的情况

不要用它查询代码内容；查询索引用 `FastContextIndexSearchTool`。普通定位用 `FastContextHybridSearchTool`。读取内容用 `FastContextReadTool`。

## 配置

读取 `PluginConfig.toml` 的 roots、exclude、索引文件数、文件大小和 `.state` 路径。

## 输入

`roots` 可选，默认使用插件配置 roots。`force` 可选，控制是否强制重建。

## 输出

返回文件数、文档数、符号数、warnings、stateFile 和刷新统计。

## 调用示例

<senera_tool_calls>
  <tool_call>
    <name>FastContextRefreshIndexTool</name>
    <arguments>
      <force>true</force>
    </arguments>
  </tool_call>
</senera_tool_calls>

## 执行约束

只读工作区并写入插件 `.state`。刷新后如需查找内容，再调用 `FastContextIndexSearchTool` 或 `FastContextHybridSearchTool`。
