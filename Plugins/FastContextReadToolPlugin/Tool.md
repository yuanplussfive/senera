# FastContextReadTool

## 简述

按路径读取本地工作区内容。文件返回行号片段；目录返回轻量子路径摘要。

## 何时使用

搜索命中后读取上下文，或需要确认具体实现时使用。拿到目录路径时也可以调用，它会返回目录摘要和下一步建议。

## 不要使用的情况

不要传 roots、query 或搜索参数；搜索请用 FastContextSearchTool。

## 输入

`path` 必填；`startLine`、`endLine`、`maxChars` 可选。

## 输出

文件返回 `kind=file`、path、startLine、endLine、totalLines、content 和 truncated。
目录返回 `kind=directory`、children、childCount、directoryCount、fileCount、truncated 和 guidance。

## 调用示例

```xml
<tool_calls>
  <tool_call>
    <name>FastContextReadTool</name>
    <arguments>
      <path>Frontend/src/App.tsx</path>
      <startLine>80</startLine>
      <endLine>160</endLine>
    </arguments>
  </tool_call>
</tool_calls>
```

## 执行约束

只能读取工作区内路径。文件必须是不超过 max_file_bytes 的文本文件；目录只返回直接子路径摘要，不递归读取内容。
