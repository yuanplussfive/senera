# FastContext Search Tools

## 简述

本地代码检索：混合搜索、符号搜索和 ripgrep 精确搜索。

## 何时使用

默认用 `FastContextHybridSearchTool` 找代码位置；找函数、组件、类型、import/export 时用 `FastContextSymbolSearchTool`；只查精确文本时用 `FastContextSearchTool`。

## 不要使用的情况

不要读取大段文件；命中后用 `FastContextReadTool` 按行读取确认。

## 配置

读取 `PluginConfig.toml` 的 roots、exclude、结果数、上下文行数和文件大小限制。

## 输入

`query` 必填。常用：`maxResults`、`contextLines`、`refreshIndex`。不确定目录时省略 `roots`。

## 输出

搜索返回路径、行号、片段、来源、分数和 warnings。符号搜索返回 name、kind、path、line、signature、imports。

## 调用示例

```xml
<tool_calls>
  <tool_call>
    <name>FastContextHybridSearchTool</name>
    <arguments>
      <query>左侧 会话 消息 数量 显示</query>
      <maxResults>8</maxResults>
    </arguments>
  </tool_call>
</tool_calls>
```

## 执行约束

只读工作区；混合/符号搜索会写插件 `.state` 索引。不要猜不存在的 roots。
