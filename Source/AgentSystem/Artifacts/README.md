# Artifacts 模块导览

Artifacts 模块负责把工具调用过程落盘为可追溯证据包。

## 阅读顺序

1. `AgentToolExecutionArtifactRecorder.ts`：工具执行 artifact 主入口。
2. `AgentArtifactEvidenceProjection.ts`：按 artifact policy 从工具结果生成 evidence。
3. `AgentArtifactTemplateProjection.ts`：渲染 summary、projection 和 evidence 展示模板。
4. `AgentArtifactRedaction.ts`：按插件声明脱敏输入和原始输出。
5. `AgentToolWorkspaceArtifactRecorder.ts` / `AgentWorkspaceArtifactWriter.ts`：workspace 变更文件写入。
6. `AgentArtifactFileWriter.ts` / `AgentArtifactStableJson.ts`：artifact 文件和稳定哈希基础能力。
7. `AgentArtifactJsonSelector.ts`：按 manifest selector 从 JSON 结果中提取字段。
8. `AgentEvidenceUri.ts`：evidence URI 生成和解析。
9. `AgentWorkspaceChangeCapture.ts`：工具执行前后工作区快照入口。
10. `AgentWorkspaceCapturePolicy.ts` / `AgentWorkspacePathSelector.ts`：workspace capture 的 manifest 策略解析和路径 selector 解析。
11. `AgentWorkspaceSnapshotBuilder.ts` / `AgentWorkspaceSnapshotDiff.ts` / `AgentWorkspaceSnapshotUtils.ts`：workspace 快照构建、差异计算和文件 hash / 文本检测工具。
12. `AgentArtifactLocator.ts`：通过 URI 查找 artifact 文件。
13. `SeneraOutputSpool.ts`：执行层共享的异步 stdout/stderr spool；Shell 和 MCP 插件输出都通过同一捕获合同落地，预览受限时仍可通过 artifact ref 分页读取已保留内容。spool 自带 session/request marker，由 retention 负责回收崩溃遗留目录。

## 扩展规则

- 工具原始输出和模型可见投影分开。
- 可复用事实必须通过 evidence URI 追溯。
- 脱敏规则来自插件 artifact policy。
- 工作区变更捕获由插件 manifest 声明 selector。
- Shell stdout/stderr 与 MCP SDK `reportOutput()` 都由执行层统一 spool，recorder 负责复制到 `stdout` / `stderr` refs；插件不需要自定义输出落盘逻辑。
- spool 的状态依次由 `open`、`sealed`、`committed` / `failed` 表示；artifact 提交成功后才允许删除，失败时保留原始输出供维护服务回收或后续诊断。
- artifact ref 读取必须使用返回的 UTF-8 `nextStartByte`，不要重复请求已经标记为 complete、unavailable 或 failed 的范围。
- 新增 artifact 行为必须补 artifact policy 验证。

## 流输出脱敏

结构化结果使用 `Redact.Keys` 和 `Redact.Paths`，stdout/stderr 使用独立的声明式规则：

```json
{
  "Redact": {
    "Streams": ["stderr"],
    "Transforms": [
      {
        "Pattern": "sk-[A-Za-z0-9_-]+",
        "Replacement": "[REDACTED]",
        "Streams": ["stdout", "stderr"],
        "WindowChars": 4096
      }
    ]
  }
}
```

`Streams` 会把指定流整体替换为 `[REDACTED]`；`Transforms` 在 artifact recorder 内部以有界流处理，能覆盖跨读取块的匹配，不会把完整 stdout/stderr 读入内存。未声明 `Streams` 的 transform 默认作用于两个流。插件只声明规则，不需要自行复制、解析或清理输出文件。非法正则、非法窗口或超过窗口的跨边界匹配会明确使 artifact 写入失败，并保留半成品标记供维护服务回收。
