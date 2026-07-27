# Senera Tool Plugin SDK

`@senera/tool-plugin-sdk` 提供外部工具插件使用的 MCP 运行时适配器和开发期契约导出器。

## 静态契约

用 Zod 一次性定义工具参数和结果。在插件开发期生成版本化的 `ToolContracts.json` 产物，再通过 `PluginManifest.json` 的 `Contracts.File` 声明它。

```js
const fs = require("node:fs");
const { createToolContractBundle } = require("@senera/tool-plugin-sdk");
const { definitions } = require("./Tools.js");

const bundle = createToolContractBundle(definitions, {
  sourceIdentity: "@example/my-plugin@1.0.0",
  sourceFile: "./Tools.js",
});
fs.writeFileSync("ToolContracts.json", `${JSON.stringify(bundle, null, 2)}\n`);
```

导出器是确定性的，会拒绝重复的工具名，并同时包含输入和输出的 Draft-07 JSON Schema。生产环境中 Senera 只加载生成的 JSON 产物，不会为了发现契约而执行插件的开发期代码。
