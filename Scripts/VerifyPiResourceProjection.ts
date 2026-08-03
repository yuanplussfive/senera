import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { toPosixPath } from "../Source/AgentSystem/Artifacts/AgentArtifactLocator.js";
import { AgentExtensionRegistry } from "../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { AgentPiPromptTemplateProjector } from "../Source/AgentSystem/Pi/AgentPiPromptTemplateProjector.js";
import { AgentPiSkillResolver } from "../Source/AgentSystem/Pi/AgentPiSkillResolver.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-pi-resource-"));
const resourceRoot = path.join(tempRoot, "resources");
fs.mkdirSync(path.join(resourceRoot, "skills"), { recursive: true });
fs.mkdirSync(path.join(resourceRoot, "templates"), { recursive: true });
fs.writeFileSync(
  path.join(resourceRoot, "skills", "SKILL.md"),
  "---\nname: skills\ndescription: Use workspace evidence.\n---\n\n# Workspace Skill\n\nUse workspace evidence.",
  "utf8",
);
fs.writeFileSync(path.join(resourceRoot, "templates", "Visible.md"), "# Visible\n\n$ARGUMENTS", "utf8");
fs.writeFileSync(path.join(resourceRoot, "templates", "Internal.md"), "# Internal", "utf8");

const registry = new AgentExtensionRegistry();
registry.registerPromptAssets(
  [
    {
      name: "VisiblePiTemplate",
      path: path.join(resourceRoot, "templates", "Visible.md"),
      description: "Visible to Pi.",
      exposeToPi: true,
      search: {
        Summary: "代码修改和测试验证模板。",
        UseCases: ["修改代码", "运行测试", "验证实现"],
      },
    },
    {
      name: "InternalTemplate",
      path: path.join(resourceRoot, "templates", "Internal.md"),
      exposeToPi: false,
    },
  ],
  [],
);

const activeSkills = [
  {
    name: "skills",
    revision: "test-revision",
    title: "工作区技能",
    summary: "验证 Pi Skill 解析。",
    useCases: ["资源投影"],
    avoid: [],
    recommendedTools: [],
    evidenceRequirements: [],
    descriptionFile: path.join(resourceRoot, "skills", "SKILL.md"),
    matchedTerms: [],
    matchedFields: [],
    score: 1,
  },
];
const resources = new AgentPiPromptTemplateProjector(registry).project({
  input: "请修改代码并运行测试验证",
  activeSkills,
});
const loadedSkills = loadSkillsFromDir({ dir: path.join(resourceRoot, "skills"), source: "verification" });
const resolvedSkills = new AgentPiSkillResolver().resolve(activeSkills, loadedSkills);

assert.deepEqual(
  resolvedSkills.map((skill) => skill.name),
  ["skills"],
);
assert.equal(resolvedSkills[0]?.filePath, toPosixPath(path.join(resourceRoot, "skills", "SKILL.md")));
assert.match(resolvedSkills[0]?.content ?? "", /Use workspace evidence/);
assert.deepEqual(
  resources.promptTemplates.map((template) => template.name),
  ["VisiblePiTemplate"],
);
assert.equal(resources.promptTemplates[0]?.description, "Visible to Pi.");
assert.match(resources.promptTemplates[0]?.content ?? "", /\$ARGUMENTS/);
assert.deepEqual(
  resources.selection.promptTemplates.map((selection) => selection.template.name),
  ["VisiblePiTemplate"],
);

console.log("Pi resource projection verified.");
