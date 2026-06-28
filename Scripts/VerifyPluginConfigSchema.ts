import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseLoadedPluginConfigToml } from "../Source/AgentSystem/Plugin/AgentPluginConfig.js";

const workspaceRoot = process.cwd();

const pluginDirs = [
  "Plugins/AgentDocumentPlugin",
  "Plugins/AgentImageVisionPlugin",
  "Plugins/FastContextIndexToolPlugin",
  "Plugins/FastContextReadToolPlugin",
  "Plugins/FastContextSearchToolPlugin",
  "Plugins/FastContextWorkspaceMapToolPlugin",
  "Plugins/TavilySearchToolPlugin",
  "Plugins/WeatherToolPlugin",
];

for (const relativePluginDir of pluginDirs) {
  const pluginDir = path.join(workspaceRoot, relativePluginDir);
  const schemaPath = path.join(pluginDir, "PluginConfig.schema.toml");
  const schemaToml = fs.readFileSync(schemaPath, "utf8");
  for (const fileName of ["PluginConfig.toml", "PluginConfig.example.toml"]) {
    const configPath = path.join(pluginDir, fileName);
    if (!fs.existsSync(configPath)) {
      continue;
    }

    const parsed = parseLoadedPluginConfigToml(fs.readFileSync(configPath, "utf8"), {
      schemaPath,
      schemaToml,
      requireSchema: true,
    });
    assert.deepEqual(
      parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
      [],
      `${relativePluginDir}/${fileName} should satisfy PluginConfig.schema.toml`,
    );
    for (const section of parsed.sections) {
      assert.ok(section.label.trim(), `${relativePluginDir}/${fileName} has an unlabeled section`);
      for (const field of section.fields) {
        assert.ok(field.label.trim(), `${relativePluginDir}/${fileName} has an unlabeled field`);
        assert.notEqual(field.type, "unknown", `${relativePluginDir}/${fileName} projected an unknown field`);
      }
    }
  }
}

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
  strictResult.diagnostics.some((diagnostic) =>
    diagnostic.severity === "error" && diagnostic.message.includes("demo.extra")
  ),
  "strict schema should reject undeclared runtime fields",
);

const missingSchemaResult = parseLoadedPluginConfigToml("[senera]\nenabled = true\n[demo]\nextra = true\n", {
  schemaPath: "PluginConfig.schema.toml",
  requireSchema: true,
});
assert.deepEqual(missingSchemaResult.sections, []);
assert.ok(
  missingSchemaResult.diagnostics.some((diagnostic) =>
    diagnostic.severity === "warning" && diagnostic.message.includes("缺少插件配置 schema")
  ),
  "missing schema should be diagnostic-only during snapshot projection",
);

console.log("Plugin config schema projection verified.");
