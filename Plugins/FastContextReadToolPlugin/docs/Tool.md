# FastContextReadTool

## 简述

按已知路径读取工作区文件片段，或查看某个目录的一层子路径摘要。

## 何时使用

已经知道 path，或从搜索结果拿到 path/line 后，需要确认具体代码、配置、README、提示词、schema、manifest 内容时使用。path 是目录时返回轻量目录摘要和下一步建议。

## 不要使用的情况

不要用它搜索未知内容，不要传 `query`、`roots`、`includeExtensions` 等搜索参数。找位置先用 `FastContextHybridSearchTool`；查看工作区总览先用 `FastContextWorkspaceMapTool`。

## 输入

`path` 必填，必须是工作区内真实路径。读取文件时可用 `startLine`、`endLine`、`maxChars` 控制范围；读取目录时只返回直接子路径摘要。

## 输出

文件返回 `kind=file`、path、startLine、endLine、totalLines、content 和 truncated。
目录返回 `kind=directory`、children、childCount、directoryCount、fileCount、truncated 和 guidance。
路径不存在返回 `kind=missing_path`、requestedPath、nearestExistingParent、parentChildren、suggestions、availableRoots 和 guidance；这种结果只用于修正下一步路径，不算已读取文件证据。

## 调用示例

<senera_tool_calls>
  <tool_call>
    <name>FastContextReadTool</name>
    <arguments>
      <path>Frontend/src/App.tsx</path>
      <startLine>80</startLine>
      <endLine>160</endLine>
    </arguments>
  </tool_call>
</senera_tool_calls>

## 执行约束

只能读取工作区内路径。文件必须是不超过 max_file_bytes 的文本文件；目录只返回直接子路径摘要，不递归读取内容。
如果返回 `missing_path`，优先从 suggestions 或 parentChildren 选择真实路径再次读取；不要把 requestedPath 当作已确认存在的文件。
