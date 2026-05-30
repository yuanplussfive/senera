# Shell Command Tool

## 简述

在宿主机工作区内执行 shell 命令，用于检查、构建、搜索、运行脚本和定位问题。

## 何时使用

需要真实执行本地命令、验证构建/类型检查、搜索文件、查看目录或运行项目脚本时使用。

## 不要使用的情况

不要执行破坏性命令，除非用户明确要求。不要把 `cwd` 指向工作区外。读取代码优先使用检索/读取工具。

## 输入

`command` 是完整命令。`cwd` 是相对工作区根目录的执行目录，默认 `.`。`timeoutMs` 可覆盖默认超时。`justification` 写明执行目的。

## 输出

返回 `command`、绝对 `cwd`、`exitCode`、`signal`、`stdout`、`stderr`。非零退出码也会返回输出，供继续分析。

## 调用示例

<senera_tool_calls>
  <tool_call>
    <name>ShellCommandTool</name>
    <arguments>
      <command>npm run check</command>
      <cwd>Frontend</cwd>
      <timeoutMs>120000</timeoutMs>
      <justification>验证前端类型检查</justification>
    </arguments>
  </tool_call>
</senera_tool_calls>

## 执行约束

命令由宿主 shell 执行；`cwd` 必须在工作区内。长任务要设置合理超时。优先使用无交互命令。
