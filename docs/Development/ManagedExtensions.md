# Skills、System Extensions 与 MCP

Senera 不要求所有扩展使用同一种外部格式。作者使用所属生态的标准格式，宿主在边界处归一化：

```text
System/Extensions/<id>/extension.json ─┐
MCPB manifest.json ────────────────────┤
MCP Registry server.json ──────────────┼─> Extension / Input / Binding 内部模型
legacy .mcp.json ──────────────────────┘
System/Skills 或 .senera/skills ─────────> standard SKILL.md
```

| 能力         | 位置                              | 作者格式                                       |
| ------------ | --------------------------------- | ---------------------------------------------- |
| 可信宿主能力 | `System/Extensions/<id>/`         | Senera `extension.json`                        |
| 内置 MCP     | `McpServers/<package>/`           | MCPB `manifest.json` 或 Registry `server.json` |
| 工作区 MCP   | `.senera/mcp/<package>/`          | MCPB、Registry，兼容 `.mcp.json`               |
| Skill        | `System/Skills`、`.senera/skills` | `SKILL.md`                                     |

纯 MCP 包不需要也不应该增加 Senera `extension.json`。MCP 工具名、参数和输出 schema 始终由 Server 的 `tools/list` 拥有。

## System extension

每个 System extension 是独立包：

```text
System/Extensions/agent-document-tools/
  extension.json
  config.schema.json
  ui.schema.json
  tools/DocumentExtract.tool.json
  observations/DocumentExtract.projection.json
```

```json
{
  "$schema": "https://schemas.senera.ai/extension/v1.json",
  "schemaVersion": 1,
  "id": "agent-document-tools",
  "version": "1.0.0",
  "displayName": {
    "zh-CN": "文档理解",
    "en-US": "Document Understanding"
  },
  "description": {
    "zh-CN": "探测并提取用户上传文档的文本、结构和元数据。",
    "en-US": "Probes and extracts text, structure, and metadata from user-uploaded documents."
  },
  "configuration": {
    "schema": "config.schema.json",
    "ui": "ui.schema.json"
  },
  "contributions": [
    {
      "kind": "hostTool",
      "contract": "tools/DocumentExtract.tool.json",
      "capability": "system.tool.agent-document-tools.DocumentExtract",
      "recommendedForSkills": []
    }
  ]
}
```

Manifest owns extension metadata and maps contract to a pre-registered capability. Contract does not repeat `extension` or `capability`. All referenced files must be regular files inside the package. Unknown capability、symbolic link and path traversal are rejected. There is no `runtimeModule` or arbitrary TypeScript import, so workspace content cannot inject code into the host process.

每个 host Tool contract 必须通过 `observationProjection` 引用包内声明式投影。投影只允许协议来源、RFC 6901 pointer、模式、优先级以及明确的 token/结构上限；完整结果先写入 artifact，模型上下文只接收有界视图与 artifact URI。投影内容参与 Tool digest 和目录 revision。MCP 与 Skill 不使用该文件：MCP 保持 `tools/list`、`outputSchema`、`content`、`structuredContent` 标准边界，Skill 只提供指导。

`displayName` 和 `description` 必须同时声明 `zh-CN` 与 `en-US`。运行时 owner、Skill 来源和自动生成的配置表单以中文为首选；设置工作台按当前界面语言展示，未知语言回退中文。包不能省略描述，也不能把中英文混写在一个字符串中。

`configuration.schema` 是包配置的权威 JSON Schema；可选的 `configuration.ui` 只描述设置页分组、顺序和控件元数据。省略 UI schema 时，宿主从 JSON Schema 的全部叶子字段生成表单。显式 UI 必须完整覆盖 schema，未知字段、漏字段、类型不匹配和违反约束的默认值都会在目录加载时失败，不通过字段名称猜测配置。面向用户的 section/field 让 `label`、`description`、`placeholder` 直接携带包含 `zh-CN`、`en-US` 的双语对象；旧字符串和 `localized*` 平行字段不会被接受。模型配置字段通过 `modelSelection.capability` 从实时模型目录生成候选，不在扩展包内复制模型 ID 列表。

包开关和普通配置保存在主配置中：

```json
{
  "Extensions": {
    "agent-document-tools": {
      "Enabled": true,
      "Configuration": {
        "output": { "maxChunks": 24 }
      }
    }
  }
}
```

`Extensions.<id>.Enabled: false` 会停止整个包的 host Tool、Skill 和 MCP contribution。`Configuration` 继承主配置的 revision、回滚、热更新和运行时 cache invalidation；它只能保存普通 JSON，Secret 必须使用 MCP input/binding 和加密 Vault。

Code-defined Zod tools use the same runtime packages. `npm run generate.system-extension-contracts` generates their committed contracts and manifests; `npm run verify.system-extension-contracts` prevents Zod/static contract drift. Implementations remain pre-registered host handlers.

`skill` and `mcpServer` contributions may reference a standard Skill directory or a standard MCP descriptor inside a composite System extension. This does not create another MCP dialect.

## MCP descriptor adapters

`AgentMcpPackageScanner` recognizes descriptors by adapter, not filename priority:

- MCPB `manifest.json`: normalizes `user_config`, `${user_config.<id>}` and `${__dirname}`.
- MCP Registry `server.json`: normalizes one unambiguous local package or Streamable HTTP route and its Input metadata.
- legacy `.mcp.json`: preserves Claude-compatible `mcpServers` configurations.

If a package contains multiple recognized runnable descriptors, or a Registry entry leaves multiple runnable routes, discovery fails with source diagnostics. It never takes the first match. Stdio commands are constructed as argv; descriptors do not pass through a shell.

MCPB bundled stdio defaults to local execution. Workspace MCPB/Registry stdio defaults to sandbox execution. Namespaced `ai.senera/execution` metadata may narrow supported targets for a Senera distribution; the host still grants only its configured backend intersection. Remote Streamable HTTP always uses the local MCP client connection and does not launch a process.

Legacy `.mcp.json` remains accepted for existing packages:

```json
{
  "execution": { "targets": ["sandbox"], "preferred": "sandbox" },
  "mcpServers": {
    "example": {
      "type": "stdio",
      "command": "node",
      "args": ["./mcp/server.mjs"],
      "cwd": ".",
      "env": { "API_TOKEN": "${API_TOKEN}" }
    }
  }
}
```

Only this compatibility adapter treats `${NAME}` conservatively as a legacy Secret with explicit host-environment fallback. New packages must declare input type and sensitivity through MCPB `user_config` or Registry Input metadata. Senera never infers Secret status from a field name.

## Typed inputs

The normalized input model supports `string`, `number`, `boolean`, `filepath`, and `directory`, plus required, Secret, default, choices, multiplicity and numeric/string bounds. Bindings explicitly identify `secret`, `config`, `oauth`, `runtime`, `hostEnvironment`, or `legacyEnvironment` sources.

- Secret values are encrypted with AES-256-GCM in the server-scoped Vault.
- Ordinary values are stored as typed JSON in a separate table.
- Secret and ordinary configuration revisions advance independently.
- Secret values never appear in snapshots, events, diagnostics or logs.
- Ordinary effective values may be projected to the settings form.

The settings workbench renders password inputs, switches, number inputs, path inputs and choice menus from the normalized declarations. Choice declarations contain unique scalar values; `multiple` inputs store arrays, with choice and boolean arrays rendered as a checkbox menu and free-form arrays edited as comma-separated values.

设置页先在本地编辑同一 MCP 服务的全部字段，再通过一个带 `requestId` 的 `mcpInput.update` 提交 `values` 和 `deletes`。服务端按 descriptor 的精确 input id 校验整批数据，拒绝未声明字段和同字段同时 set/delete，并在一个 SQLite transaction 中提交 Secret 与普通值。任一字段失败会回滚整批，两个 revision 在一次批次内各最多递增一次。成功和失败事件只回传操作关联信息，不回传 Secret、`values` 或删除字段名。

`mcpInput.set/delete` 与 `mcpCredential.set/delete` 仅作为旧客户端兼容层保留；credential alias 只能操作 descriptor 明确声明为 Secret 的 input。

Missing required inputs place only that MCP server in `needs_input`; other System Tools and MCP servers remain available. Saving an input or reconnecting advances the runtime source revision, so the next turn acquires a refreshed MCP generation.

## Skill publication

A Skill uses standard YAML frontmatter and may declare exact registered tool recommendations through `metadata.senera.recommended-tools`. Recommendations affect dynamic loading; they do not define tools or grant permission.

Host-mediated workspace operations cannot directly mutate `.senera/data`, `.senera/skills`, or `.senera/mcp`. `WorkspaceApplyPatch` stages each changed Skill or MCP package, validates the complete candidate graph, and commits only after preflight succeeds. Rejected candidates leave the active tree unchanged.

## Verification

```bash
npm run check.types
npm run check.frontend-types
npm run verify.system-extension-contracts
npx vitest run --config vitest.backend.config.ts Scripts/BackendTests/McpPackages Scripts/BackendTests/SystemTools Scripts/BackendTests/Credentials Scripts/BackendTests/ManagedExtensions
npm run build
```
