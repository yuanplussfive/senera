# WorkspaceListFiles

## Summary

通过 mcp-ripgrep 列出会被 ripgrep 搜索到的文件路径。

## When To Use

需要按 glob 或文件类型快速列出候选文件时使用。

## Avoid

搜索内容用 WorkspaceGrep；读取文件内容用 WorkspaceReadFile。
