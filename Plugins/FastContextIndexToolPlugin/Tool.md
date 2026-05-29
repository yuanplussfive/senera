# FastContextIndexTool

## 简述

构建和查询本地轻量全文/符号索引。

## 何时使用

关键词不精确、中文/英文混合、需要宽召回或预热索引时使用。

## 不要使用的情况

默认检索优先用 FastContextHybridSearchTool；读取内容用 FastContextReadTool。

## 配置

读取 `PluginConfig.toml` 的 roots、exclude、索引文件数、结果数和文件大小限制；不按扩展名过滤。

## 输入

`FastContextIndexSearchTool`：`query` 必填，可选 roots、exclude、maxResults、refreshIndex。

`FastContextRefreshIndexTool`：刷新索引，可选 roots、force。

## 输出

索引搜索返回路径、行号、片段、分数和 stats。刷新返回文件数、文档数、符号数、warnings 和 stateFile。

## 调用示例

```xml
<tool_calls>
  <tool_call>
    <name>FastContextIndexSearchTool</name>
    <arguments>
      <query>左侧 会话 消息 数量</query>
      <maxResults>8</maxResults>
    </arguments>
  </tool_call>
</tool_calls>
```

## 执行约束

只读工作区并写入插件 `.state`；结果不是完整事实，修改前继续读取确认。
