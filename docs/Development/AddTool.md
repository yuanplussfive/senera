# 新增工具开发手册

工具统一走插件体系。运行时应该从插件契约理解工具，而不是在主循环里写死工具名和字段名。

## 放在哪个目录

按工具性质选择目录：

```text
System/Plugins/<ToolPlugin>     系统工具，支撑运行时能力
Plugins/<ToolPlugin>            外部工具、业务工具、用户可扩展工具
```

普通插件进程工具通常包含：

```text
<ToolPlugin>/
  PluginManifest.json
  ToolSignature.ts
  index.js
  package.json
  docs/Tool.md
  PluginConfig.schema.toml      可选，插件配置 schema
  PluginConfig.example.toml     可选，公开配置示例
```

宿主能力工具不一定需要 `index.js`，但仍然需要 `PluginManifest.json`、`ToolSignature.ts` 和 `docs/Tool.md`。只有当工具必须访问运行时内部服务时，才应该做成宿主能力。

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

`docs/Tool.md` 是给模型看的工具说明。写法要短、具体、和签名一致。

## 执行方式

插件进程工具由 tool process runner 启动。工具必须把最后一行 stdout 写成标准结构化 JSON 响应。失败信息走 stderr，并由宿主封装成统一错误结构。

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
- `PluginManifest.json` 声明了能力、权限、入口和文档。
- `ToolSignature.ts` 匹配真实参数和结果。
- `docs/Tool.md` 说明了什么时候用、什么时候不用。
- 插件进程输出标准结构化响应。
- 可复用事实进入 artifact evidence。
- 私有配置不提交，示例配置可提交。
- 验证覆盖签名、配置、artifact、运行时行为。
