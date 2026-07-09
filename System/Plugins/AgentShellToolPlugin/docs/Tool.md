# Shell Command Tool

## 简述

在宿主机工作区内执行当前平台 shell 命令，用于检查、构建、测试、git、运行脚本、快速读取文件片段和定位问题。

## 何时使用

需要真实执行本地命令、验证构建/类型检查、运行测试、执行 git、运行项目脚本，或用当前平台 shell 快速组合只读检查时使用。

Windows 环境下命令运行在 PowerShell，优先使用 `pwsh`，可使用 `$c=Get-Content -Path Source\File.ts; $c[0..120]`、`Get-ChildItem`、`Select-String`、`Get-Command pm2`、`rg` 等写法。Linux/macOS 环境下命令运行在 POSIX shell，可使用 `sed -n '1,120p' Source/File.ts`、`ls`、`find`、`grep`、`rg` 等写法。

## 不要使用的情况

不要用 shell 直接编辑文件；工作区文件变更优先使用 WorkspaceApplyPatch。不要执行破坏性命令，除非用户明确要求。不要把 `cwd` 指向工作区外。需要结构化工具证据或大范围代码搜索时优先使用 WorkspaceGrep/WorkspaceReadFile；临时只读片段检查、组合命令和验证流程可以使用 shell。

## 输入

`command` 是完整命令，按系统提示词里的 execution_environment.shell 解释。`cwd` 是相对工作区根目录的执行目录，默认 `.`。`timeoutMs` 可覆盖默认超时。`justification` 写明执行目的。

## 输出

返回 `command`、绝对 `cwd`、`exitCode`、`signal`、`stdout`、`stderr`。非零退出码也会返回输出，供继续分析。

## 执行约束

命令由宿主 shell 执行；`cwd` 必须在工作区内。长任务要设置合理超时。优先使用无交互命令。路径优先使用工作区相对路径。
