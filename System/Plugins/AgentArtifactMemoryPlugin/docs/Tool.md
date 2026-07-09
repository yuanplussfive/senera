# ArtifactMemoryReadTool

## 简述
按 `artifactUri` 读取已经落地的工具证据包。`artifactUri` 是稳定的 Senera artifact URI，不是本地文件路径；本工具在运行时解析到工作区 artifact 存储。

## 何时使用
上下文里的 evidenceMemory 只有轻量 facts，但用户追问之前工具结果的完整摘要、投影、结构化证据、补丁或原始结果时使用。可以一次传入一个或多个 `artifactUri`。

## 不要使用的情况
当前 timeline 或 evidenceMemory 的 facts 已经足够回答时不要读取。没有 `artifactUri` 时先根据当前上下文或工具检索定位相关证据，不要猜 URI。

## 输入
- `artifactUris.item`：一个或多个 artifact URI，例如 `senera://artifact/art_1234567890abcdef12345678`。
- `refs.item`：可选，要读取的记忆引用；省略时读取 `projection`。
- `maxBytesPerRef`：可选，每个 ref 的最大返回字节数，运行时会按系统 artifact 配置继续上限保护。

## 输出
返回每个 URI 的读取状态、可用 ref 列表和已加载记忆内容。`projection` 是默认给模型阅读的紧凑投影；需要结构化记录时读取 `evidence`；需要补丁文本时读取 `workspacePatch`。

## 执行约束
本工具只读取当前工作区配置的 artifact 存储，不访问网络、不执行命令、不修改文件。工具返回内容用于当前轮证据补全，不能把读取失败当成事实来源。
