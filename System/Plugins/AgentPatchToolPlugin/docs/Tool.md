# ApplyPatchTool

## 简述

在工作区内用结构化操作修改文件，适合新增、替换、删除、插入或按行替换源码和配置。

## 何时使用

需要编辑文件时使用它；先读取目标文件，确认最新行号和内容，再提交小而明确的操作。

## 不要使用的情况

不要修改工作区外路径、依赖目录、构建产物或状态目录。只读取文件时使用读取工具。

## 输入

`operations.item` 是编辑操作数组。`action` 支持 `create_file`、`replace_file`、`delete_file`、`insert_before`、`insert_after`、`replace_range`、`delete_range`。行号从 1 开始。`cwd` 默认 `.`。`dryRun` 为 true 时只校验不写入。

## 输出

返回 `dryRun`、`changedFiles.item` 和 `diagnostics.item`。失败时返回结构化诊断，通常是路径不安全、文件不存在或行号不匹配。

## 调用示例

<senera_tool_calls>
  <tool_call>
    <name>ApplyPatchTool</name>
    <arguments>
      <operations>
        <item>
          <action>replace_range</action>
          <path>Source/example.ts</path>
          <startLine>23</startLine>
          <endLine>23</endLine>
          <content>const enabled = true;</content>
        </item>
      </operations>
      <justification>启用示例开关</justification>
    </arguments>
  </tool_call>
</senera_tool_calls>

## 执行约束

路径必须在工作区内。禁止写入 `.git`、`.senera`、`.state`、`node_modules`、`Dist`、`dist`。行级操作必须基于当前文件行号。
