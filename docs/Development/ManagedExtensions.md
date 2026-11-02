# Skills、System Extensions 与 MCP

Senera 不要求所有扩展使用同一种外部格式。作者使用所属生态的标准格式，宿主在边界处归一化：

```text
System/Extensions/<domain>/<extension>/extension.json ─┐
MCPB manifest.json ────────────────────┤
MCP Registry server.json ──────────────┼─> Extension / Input / Binding 内部模型
legacy .mcp.json ──────────────────────┘
System/Skills 或 .senera/skills ─────────> standard SKILL.md
```

| 能力         | 位置                                      | 作者格式                                       |
| ------------ | ----------------------------------------- | ---------------------------------------------- |
| 可信宿主能力 | `System/Extensions/<domain>/<extension>/` | Senera `domain.json` + `extension.json`        |
| 内置 MCP     | `McpServers/<package>/`                   | MCPB `manifest.json` 或 Registry `server.json` |
| 工作区 MCP   | `.senera/mcp/<package>/`                  | MCPB、Registry，兼容 `.mcp.json`               |
| Skill        | `System/Skills`、`.senera/skills`         | `SKILL.md`                                     |

纯 MCP 包不需要也不应该增加 Senera `extension.json`。MCP 工具名、参数和输出 schema 始终由 Server 的 `tools/list` 拥有。

包可声明设置页的 `usageExamples`：System extension 放在 `extension.json` 顶层，MCPB / Registry 放在 `ai.senera/presentation` 元数据中（legacy 放在 `presentation` 中）。每条包含 `title`、`prompt`、`outcome`，均使用 `zh-CN` / `en-US` 双语文本。示例描述真实能力和前置条件，不承诺未实现行为。宿主将其传入设置快照，前端统一绘制用途预览；不会把文档合并到工具契约或模型提示词。未声明的第三方包只显示其原始介绍和配置。

同一位置可声明双语 Markdown `documentation`，作者按实际能力、使用前提和操作流程组织内容；宿主只提供排版，不生成通用模板。渠道的 `ui.schema.json` 分区也可声明 `documentation`，目录保留简短介绍，详情展开完整说明。这些字段只影响设置页，不进入模型上下文。

## System extension

每个 System extension 是独立包：

```text
System/Extensions/explore/
  domain.json
  agent-document-tools/
    extension.json
    config.schema.json
    ui.schema.json
    tools/DocumentExtract.tool.json
```

```json
{
  "$schema": "https://schemas.senera.ai/extension/v1.json",
  "schemaVersion": 1,
  "id": "agent-document-tools",
  "domain": "explore",
  "settingsSurface": "system-tools",
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

`domain.json` owns the domain's stable identity, localized presentation default, and directory grouping. Every package directory must match `extension.id`, and `extension.domain` must equal its parent domain ID; nested domains, duplicate domain IDs, duplicate extension IDs, symbolic links and mismatches fail discovery. `settingsSurface` explicitly assigns configuration ownership to `system-tools` or a dedicated surface such as `channels`; a dedicated surface may have only one provider. The merged `domain -> extension -> Tool` presentation is sent with tool lifecycle events, so the frontend never classifies tools by name, prefix, or capability. Manifest owns package metadata and maps contract to a pre-registered capability. Contract does not repeat `extension` or `capability`. All referenced files must be regular files inside the package. Unknown capability、symbolic link and path traversal are rejected. There is no `runtimeModule` or arbitrary TypeScript import, so workspace content cannot inject code into the host process.

host Tool contract 不声明独立的 `observationProjection` 或 `contentPolicy`。`outputSchema` 可用 `x-senera-model-output: { "omit": ["/diagnostics", "/items/*/revision"] }` 声明仅供原始结果与诊断使用的字段。路径在注册时按输出 Schema 校验，数组顺序保持不变；模型视图在计费和发送前统一生成，不按字段名猜测含义。工具结果先在宿主 Artifact 边界完整记录，再由 Pi 按当前回合预算决定原样传递、结构索引或通过 Pi 请求链概括；MCP 也可在标准输出 Schema 中使用同一声明。压缩算法和预算由宿主统一管理，详见[工具反馈压缩](../Architecture/ToolObservationCompression.md)。

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

Every System extension package owns its complete public contract: manifests, tool schemas, presentation, discovery metadata, and configuration resources all live under `System/Extensions`. Extension packages do not carry an independent version: compatibility is identified by the product release, manifest `schemaVersion`, the product-owned HostCapability protocol revision, and the complete contract digest. The HostCapability protocol is encoded once in the runtime and included in each projected digest; it is never repeated in individual `.tool.json` files. `npm run verify.system-extension-contracts` reads package files without modifying them, validates every JSON Schema and package binding, and proves that each code-owned system implementation capability maps to exactly one declared host contribution. Runtime code contains only the capability-to-executor binding; it never regenerates or overwrites package contracts.

Input contracts always use standard JSON. Array fields are arrays (`"refs": ["raw"]`), not XML projection wrappers (`"refs": { "item": ["raw"] }`). XML wrappers exist only inside the BAML prompt projection and are never normalized at the Host Tool boundary. Native and BAML planning therefore receive the same generated JSON Schema and the runtime validates exactly that shape.

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

MCPB 的 `user_config` 字段可通过 `_meta["ai.senera/input"]` 显式声明展示语义。对象严格校验，不从字段名推断：

```json
{
  "DEFAULT_MODEL": {
    "type": "string",
    "title": "绘图模型",
    "default": "gpt-image-2",
    "_meta": {
      "ai.senera/input": {
        "modelSelection": { "valueKind": "model-name", "capability": "ImageOutput" }
      }
    }
  },
  "TIMEOUT": {
    "type": "number",
    "title": "请求超时",
    "default": 300,
    "_meta": { "ai.senera/input": { "durationUnit": "seconds" } }
  }
}
```

`modelSelection` 仅适用于非敏感的单个字符串。建议值来自已启用供应商中声明相应能力的已配置模型；外部 API 模型名允许手动输入，选择建议不会替换该 MCP 服务的地址或密钥。System 配置中的 `model-id` 引用则只能选择匹配能力的注册模型。`durationUnit` 仅适用于单个数字，声明原始存储单位；界面统一用秒、分钟、小时或天展示，切换单位不会修改保存值。

设置页先在本地编辑同一 MCP 服务的全部字段，再通过一个带 `requestId` 的 `mcpInput.update` 提交 `values` 和 `deletes`。服务端按 descriptor 的精确 input id 校验整批数据，拒绝未声明字段和同字段同时 set/delete，并在一个 SQLite transaction 中提交 Secret 与普通值。任一字段失败会回滚整批，两个 revision 在一次批次内各最多递增一次。成功和失败事件只回传操作关联信息，不回传 Secret、`values` 或删除字段名。

`mcpInput.set/delete` 与 `mcpCredential.set/delete` 仅作为旧客户端兼容层保留；credential alias 只能操作 descriptor 明确声明为 Secret 的 input。

Missing required inputs place only that MCP server in `needs_input`; other System Tools and MCP servers remain available. Saving an input or reconnecting advances the runtime source revision, so the next turn acquires a refreshed MCP generation.

## Skill publication

A Skill uses standard YAML frontmatter and may declare exact registered tool recommendations through `metadata.senera.recommended-tools`. Recommendations affect dynamic loading; they do not define tools or grant permission.

`SkillManage` is the resident entry point for creating, updating, validating and removing workspace Skills, and it verifies tool references before publication. It stays in every turn's tool set instead of being discovered through ToolSearch. A successful change takes effect on the next message of the same session, with no restart and no new conversation.

Host-mediated workspace operations cannot directly mutate `.senera/data`, `.senera/skills`, or `.senera/mcp`. `WorkspaceApplyPatch` stages each changed Skill or MCP package, validates the complete candidate graph, and commits only after preflight succeeds. Rejected candidates leave the active tree unchanged.

## Verification

```bash
npm run check.types
npm run check.frontend-types
npm run verify.system-extension-contracts
npx vitest run --config vitest.backend.config.ts Scripts/BackendTests/McpPackages Scripts/BackendTests/SystemTools Scripts/BackendTests/Credentials Scripts/BackendTests/ManagedExtensions
npm run build
```
