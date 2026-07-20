# ArtifactMemoryReadTool

## 简述

按 `artifactUri` 读取已经落地的工具证据包。`artifactUri` 是稳定的 Senera artifact URI，不是本地文件路径；本工具在运行时解析到工作区 artifact 存储。

## 何时使用

上下文里的 evidenceMemory 只有轻量 facts，但用户追问之前工具结果的完整摘要、投影、结构化证据、补丁或原始结果时使用。可以一次传入一个或多个 `artifactUri`。

`raw` 是经过安全投影的完整 JSON；`rawBlob` 指向同一份完整 JSON，按 UTF-8 字节范围读取，适合超大结果的增量读取；`rawPreview` 是受配置上限限制的预览。不要用 `rawPreview` 代替完整结果。

结构化 JSON 读取受独立解析预算保护。`raw` 超过预算时返回 `too_large` 和
`alternativeRef=rawBlob`，此时应改读 `rawBlob` 并按 `range.nextStartByte` 分页；不要重复请求
同一个超限 `raw`。

## 不要使用的情况

当前 timeline 或 evidenceMemory 的 facts 已经足够回答时不要读取。没有 `artifactUri` 时先根据当前上下文或工具检索定位相关证据，不要猜 URI。

## 输入

- `artifactUris.item`：一个或多个 artifact URI，例如 `senera://artifact/art_1234567890abcdef12345678`。
- `refs.item`：可选，要读取的记忆引用；省略时读取 `projection`。
- `maxBytesPerRef`：可选，每个 ref 的最大返回字节数，运行时会按系统 artifact 配置继续上限保护。
- `startBytePerRef`：可选，按 UTF-8 字节偏移继续读取。只能使用上一页返回的 `range.nextStartByte`。
- `refRanges`：可选，按 ref 指定独立的 `maxBytes` 和 `startByte`；当一次读取多个 ref 时，优先使用这里的范围，避免把一个 ref 的分页偏移误用于其他 ref。

单次 URI 数量、每个 URI 的 ref 数量和文件读取并发由全局 `Artifacts.MemoryReadMaxArtifacts`、
`Artifacts.MemoryReadMaxRefs` 与 `Artifacts.MemoryReadMaxConcurrency` 控制；这些限制适用于所有
artifact memory 调用，不由具体插件自行决定。

可读取的 ref 包括 `summary`、`projection`、`evidence`、`delta`、`raw`、`rawBlob`、
`rawPreview`、`workspaceDiff`、`workspacePatch`、`stdout` 和 `stderr`。`stdout` / `stderr` 不再是
Shell 专属：MCP 插件通过 SDK `reportOutput()` 产生的输出也会自动进入同一份异步 artifact 捕获。
模型上下文中的输出预览可能已经被截断，但不影响通过 URI 分页读取 artifact 中的完整捕获文件。

## 输出

返回每个 URI 的读取状态、可用 ref 列表和已加载记忆内容。每个 memory 先返回 `range`：
`complete=true` 表示该 ref 已读完，不应重复调用；否则用 `nextStartByte` 作为下一次
`startBytePerRef`。`projection` 是默认给模型阅读的紧凑投影；需要结构化记录时读取
`evidence`；需要补丁文本时读取 `workspacePatch`。

新格式 manifest 会为可读 ref 提供 `mediaType`、`byteLength` 和 `sha256`；分页内容中的
`sourceSha256` 标识其源文件，可用于判断重复读取和审计内容版本。

`refResults.item` 对每个请求 ref 返回明确状态：`loaded`、`unavailable`、`too_large` 或
`failed`。后三者在当前 turn 内属于终态，使用相同 URI/ref/参数重复调用不会得到新信息。
`oversizedRefCount` 汇总超过结构化 JSON 预算的 ref 数量。

## 执行约束

本工具只读取当前工作区配置的 artifact 存储，不访问网络、不执行命令、不修改文件。工具返回内容用于当前轮证据补全，不能把读取失败当成事实来源。
