# Senera Tool Plugin SDK

`@senera/tool-plugin-sdk` provides the MCP runtime adapter and the build-time contract exporter used by external tool plugins.

## Static contracts

Define tool arguments and results once with Zod. Generate the versioned `ToolContracts.json` artifact during plugin development, then declare it through `Contracts.File` in `PluginManifest.json`.

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

The exporter is deterministic, rejects duplicate tool names, and includes both input and output Draft-07 JSON Schemas. Senera loads only the generated JSON artifact in production; it does not execute plugin authoring code to discover contracts.
