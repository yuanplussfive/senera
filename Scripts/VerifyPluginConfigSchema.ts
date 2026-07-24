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
  "required = true",
  "essential = true",
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

const missingSwitchResult = parseLoadedPluginConfigToml("[senera]\n", {
  schemaPath: "PluginConfig.schema.toml",
  schemaToml: strictSchema,
  requireSchema: true,
});
assert.equal(missingSwitchResult.sections[0]?.fields[0]?.required, true);
assert.ok(
  missingSwitchResult.diagnostics.some(
    (diagnostic) => diagnostic.severity === "error" && diagnostic.message.includes("启用插件"),
  ),
  "declared required switches should report missing values",
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

const requiredSchema = [
  "[form]",
  "version = 1",
  "strict = true",
  "",
  "[[form.sections]]",
  'id = "service"',
  'label = "服务配置"',
  "",
  "[[form.sections.fields]]",
  'path = ["service", "endpoint"]',
  'label = "服务地址"',
  'type = "string"',
  "required = true",
  "essential = true",
  "",
  "[[form.sections.fields]]",
  'path = ["service", "timeout"]',
  'label = "请求超时"',
  'type = "number"',
  "required = false",
  "essential = false",
  "",
].join("\n");

const requiredResult = parseLoadedPluginConfigToml("[service]\n", {
  schemaPath: "PluginConfig.schema.toml",
  schemaToml: requiredSchema,
  requireSchema: true,
});
assert.equal(requiredResult.sections[0]?.fields[0]?.required, true);
assert.equal(requiredResult.sections[0]?.fields[1]?.required, false);
assert.equal(requiredResult.sections[0]?.fields[0]?.essential, true);
assert.equal(requiredResult.sections[0]?.fields[1]?.essential, false);
assert.ok(
  requiredResult.diagnostics.some(
    (diagnostic) => diagnostic.severity === "error" && diagnostic.message.includes("服务地址"),
  ),
  "explicitly required fields should report missing values",
);
assert.ok(
  requiredResult.diagnostics.every((diagnostic) => !diagnostic.message.includes("请求超时")),
  "fields without an explicit required declaration should remain optional",
);

console.log("Plugin config schema projection verified.");
