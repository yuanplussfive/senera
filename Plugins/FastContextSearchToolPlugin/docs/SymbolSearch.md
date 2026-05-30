# FastContextSymbolSearchTool

## 简述

按符号查找函数、类、类型、组件、常量和 import/export 定义。

## 何时使用

已知或大致知道函数名、类名、类型名、React/Vue 组件名、导出名，想找定义、签名或声明位置时使用。适合“找到 createDecisionStreamingPreviewRules 定义”“SessionList 组件在哪里”。

## 不要使用的情况

搜索普通文本、错误信息、UI 文案或自然语言问题时用 `FastContextHybridSearchTool`。只查精确字符串或正则时用 `FastContextSearchTool`。读取命中内容用 `FastContextReadTool`。

## 配置

读取 `PluginConfig.toml` 的 roots、exclude、索引文件数、结果数和 `.state` 符号索引设置。

## 输入

`query` 必填，可写符号名或符号片段。可选 `kind` 限定 function、class、interface、type、enum、const、component；可选 `refreshIndex`。

## 输出

返回 name、kind、path、line、signature、imports、score 和 warnings。

## 调用示例

<senera_tool_calls>
  <tool_call>
    <name>FastContextSymbolSearchTool</name>
    <arguments>
      <query>createDecisionStreamingPreviewRules</query>
      <kind>
        <item>function</item>
      </kind>
      <maxResults>8</maxResults>
    </arguments>
  </tool_call>
</senera_tool_calls>

## 执行约束

只读工作区；可能写入插件 `.state` 索引。结果只定位声明位置，修改前继续读取相关代码。
