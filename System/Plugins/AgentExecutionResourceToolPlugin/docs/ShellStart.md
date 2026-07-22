# Shell Start Tool

## 简述

启动可持续通信的后台 shell 进程并立即返回资源句柄，不等待命令结束。

## 何时使用

命令会长期运行、需要后续读取增量输出、输入文本或发送终止信号时使用，例如开发服务器、交互式 CLI、监控任务和较长构建。普通短命令仍使用 ShellCommandTool。

## 不要使用的情况

不要用它直接编辑文件。不要为几秒内结束且无需交互的命令创建后台资源。不要启动超出当前任务范围的常驻服务。

## 输入

`command` 是结构化 shell 命令：`mode` 固定为 `shell`，`dialect` 明确声明 `posix-sh` 或 `powershell`，`script` 是脚本文本。该工具同时支持 `Sandbox` 与 `Local`，调用时必须通过 `executionTarget` 明确选择；`Sandbox` 使用 Linux `posix-sh`，`Local` 使用宿主 shell。`cwd` 是工作区内执行目录，`justification` 说明执行目的。

## 输出

返回不可猜测的 `resourceId`、状态、进程号、事件游标、实际执行边界、终端后端和能力列表。后续通过 ExecutionResourceWait、ExecutionResourceWrite、ExecutionResourceSignal 和 ExecutionResourceInspect 控制。只有资源声明支持 `resize` 时才能调整尺寸。

## 执行约束

资源只允许同一会话访问；没有会话标识时退化为同一请求访问。输出按预算有界保留，断线后可用游标恢复并继续接收工作区事件。沙箱不可用或缺少所需能力时，选择 `Sandbox` 的调用会直接失败；运行时不会改在宿主机启动，也不会重试到另一目标。

shell 方言必须与实际后端一致。运行时不会把 PowerShell 自动翻译为 POSIX shell，也不会把不兼容脚本静默转到宿主机。
