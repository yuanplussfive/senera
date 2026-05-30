# FastContextHybridSearchTool

## 简述

用混合检索定位本地代码、配置、文档或 UI 文案的候选位置。

## 何时使用

不知道具体文件但要找实现、错误码、事件名、组件、提示词、配置项或跨语言关键词时优先使用。适合“左侧会话消息数量在哪里显示”“InvalidXmlEnvelope 哪里触发”这类抽象问题。

## 不要使用的情况

已知精确字符串或正则时用 `FastContextSearchTool`。只找函数、类型、组件定义时用 `FastContextSymbolSearchTool`。读取文件内容用 `FastContextReadTool`，查看目录用 `FastContextWorkspaceMapTool`。

## 配置

读取 `PluginConfig.toml` 的 roots、exclude、结果数、上下文行数、文件大小和 `.state` 索引设置。

## 输入

`query` 必填，可写自然语言、路径片段、标识符、错误文本或 UI 文案。常用 `maxResults`、`contextLines`、`refreshIndex`；不确定目录时省略 `roots`。

## 输出

返回候选 path、line、snippet、score、source、warnings 和 availableRoots。结果是定位线索，不是完整上下文。

## 调用示例

<senera_tool_calls>
  <tool_call>
    <name>FastContextHybridSearchTool</name>
    <arguments>
      <query>左侧 会话 消息 数量 显示</query>
      <maxResults>8</maxResults>
    </arguments>
  </tool_call>
</senera_tool_calls>

## 执行约束

只读工作区；可能写入插件 `.state` 索引。命中后用 `FastContextReadTool` 按行读取确认。
