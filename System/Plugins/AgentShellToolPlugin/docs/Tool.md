# Shell Command Tool

## 简述

在受策略选择的工作区执行边界内运行 shell 命令，用于检查、构建、测试、git、运行脚本、快速读取文件片段和定位问题。

## 何时使用

需要真实执行本地命令、验证构建/类型检查、运行测试、执行 git、运行项目脚本，或用当前平台 shell 快速组合只读检查时使用。

该工具是 `SandboxPreferred`：正常执行目标为 Linux sandbox，使用 `posix-sh`。只有执行策略明确选择 `Local` 时，Windows 才使用 PowerShell。必须根据 `execution_environment.execution_targets` 选择方言。

## 不要使用的情况

不要用 shell 直接编辑文件；工作区文件变更优先使用 WorkspaceApplyPatch。不要执行破坏性命令，除非用户明确要求。不要把 `cwd` 指向工作区外。需要结构化工具证据或大范围代码搜索时优先使用 WorkspaceGrep/WorkspaceReadFile；临时只读片段检查、组合命令和验证流程可以使用 shell。

## 输入

`command` 是结构化 shell 命令，包含 `mode: "shell"`、`dialect` 和 `script`。`cwd` 是相对工作区根目录的执行目录，默认 `.`。`timeoutMs` 可覆盖默认超时。`justification` 写明执行目的。

## 输出

返回 `command`、绝对 `cwd`、`exitCode`、`signal`、`stdout`、`stderr` 以及输出字节数和截断状态。非零退出码也会返回输出，供继续分析。输出超过保留预算时继续运行命令，只截断模型结果和实时事件，不因日志体量自动终止命令。

工具结果会生成 artifact URI。模型需要完整 stdout/stderr 时，使用 `ArtifactMemoryReadTool` 的 `stdout` 或 `stderr` ref 分页读取；读取结果会标明是否达到输出捕获上限，不能把截断捕获当成完整日志。

## 执行约束

命令由策略选中的后端执行；`cwd` 必须在工作区内。方言不兼容会返回类型化错误，不会自动翻译或静默宿主重试。长任务要设置合理超时。优先使用无交互命令。路径优先使用工作区相对路径。
