# WorkspaceSearchFiles

## Summary

通过 MCP filesystem server 使用 glob 模式搜索工作区文件路径。

## When To Use

知道文件名片段、扩展名或路径模式，需要定位真实路径时使用。

## Avoid

它只匹配路径，不搜索内容。搜索文本、错误码或代码片段时用 WorkspaceGrep。
