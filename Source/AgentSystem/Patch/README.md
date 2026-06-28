# Patch 模块导览

Patch 模块实现内置 `ApplyPatchTool`。它负责把结构化编辑请求转换成写入计划，并在工作区安全边界内提交文件变更。

## 阅读顺序

1. `AgentPatchApplyRuntime.ts`：host tool 入口，负责参数解析、调用规划和返回结构化工具结果。
2. `AgentPatchApplyTypes.ts`：工具参数 schema、编辑动作、写入计划和领域错误类型。
3. `AgentPatchPlanner.ts`：把 create/replace/delete/range edit 操作转换成文件写入计划。
4. `AgentPatchLineEdit.ts` / `AgentPatchText.ts`：行级编辑和换行归一化。
5. `AgentPatchPathResolver.ts`：工作区路径解析和受保护目录拦截。
6. `AgentPatchCommitter.ts`：按写入计划实际落盘。
7. `AgentPatchErrorProjection.ts`：把领域错误转换成工具进程错误 envelope。

## 扩展规则

- 新增编辑动作先扩展 schema 和 planner，不在 runtime 入口写分支。
- 所有路径必须先走 `AgentPatchPathResolver`，不能在其他模块自行拼绝对路径。
- 写入文件只发生在 `AgentPatchCommitter`，dryRun 必须只构建计划。
