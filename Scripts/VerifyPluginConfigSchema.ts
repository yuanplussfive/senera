import assert from "node:assert/strict";
import { parseLoadedPluginConfigToml } from "../Source/AgentSystem/Plugin/AgentPluginConfig.js";

const strictSchema = [
  "[form]",
  "version = 1",
  "strict = true",
  "",
  "[[form.sections]]",
  'id = "senera"',
  'label = "启用状态"',
  "",
  "[[form.sections.fields]]",
  'path = ["senera", "enabled"]',
  'label = "启用插件"',
  'type = "boolean"',
  "",
].join("\n");

const strictResult = parseLoadedPluginConfigToml("[senera]\nenabled = true\n[demo]\nextra = true\n", {
  schemaPath: "PluginConfig.schema.toml",
  schemaToml: strictSchema,
  requireSchema: true,
});
assert.ok(
  strictResult.diagnostics.some(
    (diagnostic) => diagnostic.severity === "error" && diagnostic.message.includes("demo.extra"),
  ),
  "strict schema should reject undeclared runtime fields",
);

const missingSchemaResult = parseLoadedPluginConfigToml("[senera]\nenabled = true\n[demo]\nextra = true\n", {
  schemaPath: "PluginConfig.schema.toml",
  requireSchema: true,
});
assert.deepEqual(missingSchemaResult.sections, []);
assert.ok(
  missingSchemaResult.diagnostics.some(
    (diagnostic) => diagnostic.severity === "warning" && diagnostic.message.includes("缺少插件配置 schema"),
  ),
  "missing schema should be diagnostic-only during snapshot projection",
);

console.log("Plugin config schema projection verified.");
