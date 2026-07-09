# WorkspaceCreateDirectory

## Summary

通过 MCP filesystem server 创建工作区目录，目录已存在时视为成功。

## When To Use

写入新文件前需要确保父目录存在，或需要初始化新的插件、文档、资源目录时使用。

## Avoid

只查看目录结构时使用 WorkspaceListDirectory。
