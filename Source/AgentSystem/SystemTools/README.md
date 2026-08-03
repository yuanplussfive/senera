# System Tools 与 System Extensions

本目录只实现可信宿主能力及其运行时绑定。对外可发现的包元数据、Tool 合同和配置声明位于 `System/Extensions/<id>/`，运行时代码不能从扩展包任意导入模块。

## 包结构

```text
System/Extensions/<id>/
  extension.json
  config.schema.json     # 可选，JSON Schema Draft 7
  ui.schema.json         # 可选，设置表单布局
  tools/*.tool.json
  skills/*               # 可选
  mcp/*                  # 可选
```

`extension.json` 负责包身份和 contributions。`hostTool.capability` 必须指向 `AgentSystemToolCatalog.ts` 中预注册的宿主能力；包内容不能指定 `runtimeModule`。`skill` 和 `mcpServer` contribution 分别引用包内标准 Skill 目录和标准 MCP descriptor。

每个包必须用结构化 `displayName` 和 `description` 同时声明 `zh-CN`、`en-US`。后端公共解析器固定优先中文，设置快照保留双语原文供前端按 locale 展示。缺少任一语言、空名称或空描述都会使扩展目录校验失败。

配置由包拥有。`configuration.schema` 是值的权威契约，`configuration.ui` 只描述展示顺序和控件元数据；省略 UI schema 时由 JSON Schema 自动生成完整表单。UI 引用未知字段、遗漏字段、类型不一致、无效默认值、越界路径或符号链接都会使目录构建失败。

面向用户的显式 UI schema 必须让 section 和 field 的 `label` 直接声明 `zh-CN`、`en-US` 双语对象；`description`、`placeholder` 存在时遵循同一结构。系统扩展配置协议不接受旧字符串或 `localized*` 平行字段。模型字段使用 `modelSelection` 声明能力要求，前端从当前模型目录生成候选，不能把供应商或模型列表硬编码进插件包。

用户选择存入主配置：

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

禁用扩展会停止该包的 Tool、Skill 和 MCP contributions。普通配置继承主配置的 revision、回滚、热更新和运行时 cache invalidation。Secret 不允许写入 `Extensions.*.Configuration`，需要 Secret 的 MCP contribution 必须使用 MCP descriptor 的显式 input/binding 和加密 Vault。

代码定义的 Zod Tool 通过 `npm run generate.system-extension-contracts` 生成并提交包合同、配置 schema 和 UI schema；`npm run verify.system-extension-contracts` 防止运行时定义与静态包漂移。

`agent-image-tools` 当前拥有三组配置：视觉模型选择、单图读取预算和视觉系统提示词。留空模型选择时优先使用当前会话模型，不具备 Vision 能力时回退到首个可用视觉模型；显式选择的模型不存在或不支持 Vision 时直接返回结构化错误，不静默猜测其他模型。

## 代码边界

- `AgentSystemToolSource.ts` 只遍历扩展目录、注册 contribution 并生成设置目录。
- `AgentSystemExtensionManifest.ts` 独占 manifest、contribution 和 Tool contract 的 Zod 契约。
- `AgentSystemExtensionConfiguration.ts` 独占 JSON Schema 默认值物化、UI 自动生成及 UI/schema 一致性校验。
- `AgentSystemExtensionPackagePath.ts` 独占包内相对路径、regular file/directory 和符号链接边界。

新增 contribution 类型时先扩展 manifest 契约，再在 catalog 增加投影；新增配置控件语义只能进入 configuration reader，不能把 AJV 或表单遍历重新写回 catalog。
