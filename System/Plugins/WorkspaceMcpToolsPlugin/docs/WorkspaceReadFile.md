# WorkspaceReadFile

## Summary

通过 MCP filesystem server 读取工作区文本文件。

## When To Use

已知道真实文件路径，需要查看源码、配置或文档内容时使用。

## Avoid

不要用它猜路径；不知道路径时先使用 WorkspaceGrep、WorkspaceSearchFiles 或 WorkspaceListDirectory。
