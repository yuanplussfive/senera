import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentPluginRegistry } from "../Source/AgentSystem/Plugin/AgentPluginRegistry.js";
import { AgentPiResourceProjector } from "../Source/AgentSystem/Pi/AgentPiResourceProjector.js";
import type { LoadedPlugin } from "../Source/AgentSystem/Types/PluginRuntimeTypes.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-pi-resource-"));
const pluginRoot = path.join(tempRoot, "Plugin");
fs.mkdirSync(path.join(pluginRoot, "skills"), { recursive: true });
fs.mkdirSync(path.join(pluginRoot, "templates"), { recursive: true });
fs.writeFileSync(
  path.join(pluginRoot, "skills", "Workspace.md"),
  "# WorkspaceSkill\n\nUse workspace evidence.",
  "utf8",
);
fs.writeFileSync(path.join(pluginRoot, "templates", "Visible.md"), "# Visible\n\n$ARGUMENTS", "utf8");
fs.writeFileSync(path.join(pluginRoot, "templates", "Internal.md"), "# Internal", "utf8");

const registry = new AgentPluginRegistry();
registry.registerPlugin({
  rootPath: pluginRoot,
  rootKind: "System",
  manifestPath: path.join(pluginRoot, "PluginManifest.json"),
  config: loadedPluginConfig(pluginRoot),
  manifest: {
    ManifestVersion: 2,
    Plugin: {
      Name: "VerifyPiResourcePlugin",
      Version: "0.1.0",
      Kind: "Skill",
    },
    Skills: [
      {
        Name: "WorkspaceSkill",
        Title: "工作区技能",
        DescriptionFile: "./skills/Workspace.md",
        RecommendedTools: ["WorkspaceReadFile"],
      },
    ],
    Templates: [
      {
        Name: "VisiblePiTemplate",
        Path: "./templates/Visible.md",
        Description: "Visible to Pi.",
        ExposeToPi: true,
        Search: {
          Summary: "代码修改和测试验证模板。",
          UseCases: ["修改代码", "运行测试", "验证实现"],
        },
      },
      {
        Name: "InternalTemplate",
        Path: "./templates/Internal.md",
      },
    ],
  },
} satisfies LoadedPlugin);

const resources = new AgentPiResourceProjector(registry).project({
  input: "请修改代码并运行测试验证",
  activeSkills: [
    {
      name: "WorkspaceSkill",
      title: "工作区技能",
      summary: "验证 skill resource 投影。",
      useCases: ["资源投影"],
      avoid: [],
      recommendedTools: [],
      evidenceRequirements: [],
      descriptionFile: path.join(pluginRoot, "skills", "Workspace.md"),
      matchedTerms: [],
      matchedFields: [],
      score: 1,
    },
  ],
});

assert.deepEqual(
  resources.harnessResources.skills?.map((skill) => skill.name),
  ["WorkspaceSkill"],
);
assert.equal(resources.harnessResources.skills?.[0]?.filePath, path.join(pluginRoot, "skills", "Workspace.md"));
assert.match(resources.harnessResources.skills?.[0]?.content ?? "", /Use workspace evidence/);
assert.deepEqual(
  resources.harnessResources.promptTemplates?.map((template) => template.name),
  ["VisiblePiTemplate"],
);
assert.equal(resources.harnessResources.promptTemplates?.[0]?.description, "Visible to Pi.");
assert.match(resources.harnessResources.promptTemplates?.[0]?.content ?? "", /\$ARGUMENTS/);
assert.deepEqual(
  resources.selection.promptTemplates.map((selection) => selection.template.name),
  ["VisiblePiTemplate"],
);

console.log("Pi resource projection verified.");

function loadedPluginConfig(rootPath: string): LoadedPlugin["config"] {
  return {
    fileName: "PluginConfig.toml",
    path: path.join(rootPath, "PluginConfig.toml"),
    exists: false,
    source: "default",
    templateExists: false,
    needsUserConfig: false,
    toml: "",
    sections: [],
    runtime: {
      enabled: true,
      tools: {},
    },
    diagnostics: [],
  };
}
