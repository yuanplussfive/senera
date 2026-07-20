# 新增工具开发手册

工具统一走插件体系。运行时应该从插件契约理解工具，而不是在主循环里写死工具名和字段名。

## 放在哪个目录

按工具性质选择目录：

```text
System/Plugins/<ToolPlugin>     系统工具，支撑运行时能力
Plugins/<ToolPlugin>            外部工具、业务工具、用户可扩展工具
```

标准 MCP 工具插件通常包含：

```text
<ToolPlugin>/
  PluginManifest.json
  ToolSignature.ts
  <mcp-server-entry>
  docs/Tool.md
  PluginConfig.schema.toml      可选，插件配置 schema
  PluginConfig.example.toml     可选，公开配置示例
```

宿主能力工具不需要独立进程入口，但仍然需要 `PluginManifest.json`、`ToolSignature.ts` 和 `docs/Tool.md`。只有当工具必须访问运行时内部服务时，才应该做成宿主能力；可独立部署的外部能力使用标准 MCP，不再使用 Senera 私有插件进程协议。

## 工具契约

`ToolSignature.ts` 是工具参数和结果的正式契约，会影响：

- 工具参数 schema。
- Pi tool schema 和 PiProxy+BAML 工具调用编译。
- 模型提示里的工具说明。
- 验证脚本。
- artifact policy 的结果投影。

写契约时注意：

- 必填参数只放工具真正无法运行时缺少的字段。
- 可选参数必须对应真实能力，不要把提示词偏好塞进参数。
- result schema 要匹配工具实际输出。
- 除非工具本身是通用传输层，否则不要接受大而泛的 `any`。

`PluginManifest.json` 声明工具身份、入口、能力、权限、artifact 策略、文档和配置。宿主应该读取 manifest，不应该靠工具名猜语义。

所有插件使用 `ManifestVersion: 2`。仓库内置工具必须显式声明 `Loading`、`Handler`、`Execution` 和 `Runtime`；运行时不会根据 handler 类型推断默认生命周期，也不接受 v1 manifest。

`Loading` 决定动态工具模式下的模型可见性：

- `Bootstrap` 只用于能力发现等每轮都必须可见的极小控制面。
- `Dynamic` 用于业务、执行、检索和工作区工具，由语义召回、技能推荐或显式配置加载。

插件位于 `System/Plugins` 只表示系统信任与所有权，不等于工具应常驻模型上下文。第三方 v2 manifest 缺少 `Loading` 时按 `Dynamic` 处理。

Handler 与 Runtime 使用单一合同：

- `HostCapability` 必须声明 `ProtocolVersion: 2`，支持 `Immediate`、`OneShot`、`Persistent` 和 `RemoteJob`。
- `McpTool` 使用 MCP 自身协议，不得声明私有 `ProtocolVersion`，支持 `Immediate`、`OneShot`、`Persistent` 和 `RemoteJob`。
- `Persistent` 复用按 server manifest 和执行安全 profile 隔离的连接；`RemoteJob` 在此基础上使用 MCP Tasks 的创建、查询、结果与取消协议。
- 使用 `@senera/tool-plugin-sdk` 时，宿主会从 manifest 向同一 MCP server 投影 `RemoteJob` 工具集合，插件不应在代码里重复声明生命周期。SDK 默认任务存储只保证进程内生命周期；需要跨进程恢复时必须传入持久化 `TaskStore`。

不要为旧 manifest、缺失版本或私有进程 handler 增加 fallback。schema、runtime 和 verifier 共用同一合同，声明不兼容时应在插件加载阶段失败。

MCP 工具中表示文件或目录的参数必须在 `Handler.Resources` 声明。`Pointer` 使用 RFC 6901 JSON Pointer，`Intent` 描述资源访问语义；宿主据此调用统一的真实路径、符号链接边界和 OPA 授权，不在运行时代码里按 server 或 tool 名称推断参数：

```json
{
  "Handler": {
    "Kind": "McpTool",
    "Server": "filesystem",
    "Tool": "edit_file",
    "Resources": [
      {
        "Pointer": "/path",
        "Intent": {
          "Selector": "/dryRun",
          "Cases": [{ "Equals": true, "Intent": "read" }],
          "Default": "replace"
        }
      }
    ]
  }
}
```

固定访问直接写 `"Intent": "read"`。条件意图只用于同一工具确实会根据参数改变副作用的情况；它不是授权规则，不能替代 `Execution`、`Permissions`、审批或 OPA。

工具返回结果后，宿主会生成独立的模型 observation 和 durable artifact。不要让 artifact summary 成为模型读取本次结果的唯一入口。对于长任务、分页读取或可恢复资源，在 `Observation.Continuation` 中用 JSON selector 声明 handle、cursor、state 和终态；不要在运行时代码里按工具名识别这些字段。

`Observation.MaxTokens` 控制本次结果进入模型的预算。超出预算时宿主返回显式 token preview，并继续提供 artifact URI。只有 artifact projection 确实补充了正文时才启用 `IncludeArtifactProjection`，避免元数据重复占用上下文。

`docs/Tool.md` 是给模型看的工具说明。写法要短、具体、和签名一致。

## 执行方式

MCP 工具通过 manifest 声明的 MCP server transport 启动并遵循 MCP 请求、结果和生命周期协议。不要在 MCP stdout 混入非协议输出；诊断信息写入 stderr。

`RemoteJob` 表示工具调用由 MCP Task 拥有，不等于自动具备进程重启恢复。只有任务状态、结果和事件游标都由持久化存储拥有，并经过断线与重启恢复测试后，才可以声明 `ResumableEvents: true`。

SDK 提供可选的 `FileTaskStore`，适合单个 MCP server 进程独占一个绝对存储目录的场景：

```js
const path = require("node:path");
const { runMcpToolSuite } = require("@senera/tool-plugin-sdk");
const { FileTaskStore } = require("@senera/tool-plugin-sdk/task-store");
const taskStore = new FileTaskStore({
  rootPath: path.resolve(process.env.PLUGIN_STATE_ROOT, "mcp-tasks"),
});

void runMcpToolSuite(definitions, {
  taskStore,
  taskEventStore: taskStore,
});
```

它持久化终态、结果和带连续 cursor 的 progress/output 事件，执行 TTL 清理，并在重启时把旧进程遗留的非终态任务转成带 `TaskOwnerLost` 结果的失败任务，不会假装已经恢复丢失的执行闭包。多进程共享和外部作业重新附着应使用具备租约与所有权协议的数据库或队列实现。

宿主在已经收到 `taskId` 后遇到连接关闭或请求超时，会重建一次连接，先通过版本化 `senera/tasks/events` 从最后连续 cursor 回放事件，再用标准 `tasks/get`、`tasks/result` 重新附着同一任务；不会重新发送 `tools/call`。回放页出现 cursor 缺口会失败关闭，不能静默跳过。

MCP 工具声明 `ResumableEvents: true` 时，生命周期必须是 `RemoteJob`，必须声明 `Cancellation: true`，并至少启用 `Progress` 或 `OutputStreaming`。对应 MCP server 还必须配置 `taskEventStore` 并在握手中提供 `experimental["senera.task-events"].version = 1`；否则 Host 会在执行前明确拒绝。

宿主能力工具在主进程内执行。适用场景包括：

- 需要访问 runtime repository。
- 需要读写运行时状态。
- 需要复用宿主已有索引或 artifact 服务。

普通外部工具不要随意做成宿主能力。

## Artifact 策略

如果工具结果里有模型后续会引用的事实，必须在 `PluginManifest.json` 里声明 artifact evidence。

artifact policy 应该描述：

- 哪些输入字段需要脱敏。
- 从结果中提取哪些 evidence records。
- evidence 的稳定 identity。
- 展示给用户的 label / display / locator。
- 投影给模型的字段。
- 工具会改文件时的 workspace capture selector。

检索工具如果读取的是另一个 artifact，应通过 `PlannerMemory.ArtifactUri` 指向源 URI，并通过 `PlannerMemory.ArtifactRefsSlot` 记录已经加载的 refs。检索调用自身生成的 artifact 只是执行追踪，不应成为下一轮推荐的读取目标。

工具只负责返回事实，artifact policy 负责决定哪些事实进入证据包以及怎么展示。

## 插件配置

私有配置写在 `PluginConfig.toml`，不要提交。

公开 schema 写在：

```text
PluginConfig.schema.toml
```

公开示例写在：

```text
PluginConfig.example.toml
```

如果配置需要在前端 UI 里编辑，必须保证插件配置 schema 能被现有配置投影链路读取。

## 必须验证

优先更新现有核心验证脚本，只有出现新的独立运行时边界时才新增 `Scripts/Verify*.ts`。

常规验证：

```bash
npm run check.types
npm run build
npm run verify.suite -- workspace core
```

工具契约相关重点验证：

```bash
node Dist/Scripts/VerifyPluginConfigSchema.js
node Dist/Scripts/VerifyPluginArtifactPolicies.js
node Dist/Scripts/VerifyToolSignatureMappingAndPlanValidation.js
```

如果工具输出会影响前端显示，还要跑：

```bash
npm run test.frontend
```

## 上线前检查

- 插件目录放在正确位置。
- `PluginManifest.json` 使用 `ManifestVersion: 2`，并显式声明了 handler、runtime、能力、权限、入口和文档。
- `ToolSignature.ts` 匹配真实参数和结果。
- `docs/Tool.md` 说明了什么时候用、什么时候不用。
- MCP 工具使用标准 MCP transport；宿主工具显式声明私有协议 v2。
- 可复用事实进入 artifact evidence。
- 私有配置不提交，示例配置可提交。
- 验证覆盖签名、配置、artifact、运行时行为。
