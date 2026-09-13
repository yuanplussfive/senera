import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { parseAgentSkillDocument } from "../../../Source/AgentSystem/Skills/AgentSkillDocument.js";
import { AgentSkillScanner, AgentSkillResourceKinds } from "../../../Source/AgentSystem/Skills/AgentSkillScanner.js";
import { createAgentSelfSkillsPort } from "../../../Source/AgentSystem/SelfService/AgentSelfSkills.js";

describe("skill creator package resources", () => {
  const skillsRoot = path.resolve(process.cwd(), "System", "Skills");
  const skillRoot = path.join(skillsRoot, "skill-creator");

  test("keeps the authoring template and package contract as bounded resources", () => {
    const scanner = new AgentSkillScanner();
    const resources = scanner.listResources(skillRoot);
    expect(resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: "templates/SKILL.md",
          kind: AgentSkillResourceKinds.Template,
        }),
        expect.objectContaining({
          relativePath: "references/package-contract.md",
          kind: AgentSkillResourceKinds.Reference,
        }),
      ]),
    );
    expect(
      createAgentSelfSkillsPort([{ id: "system", displayName: "Senera", kind: "system", root: skillsRoot }]).resources(
        "skill-creator",
      ),
    ).toMatchObject({
      status: "found",
      resources: expect.arrayContaining([
        expect.objectContaining({ relativePath: "templates/SKILL.md", kind: AgentSkillResourceKinds.Template }),
      ]),
    });

    const template = fs.readFileSync(path.join(skillRoot, "templates", "SKILL.md"), "utf8");
    const document = parseAgentSkillDocument(template);
    expect(document.data).toMatchObject({
      name: "example-skill",
      "disable-model-invocation": false,
      metadata: { senera: { "recommended-tools": [] } },
    });
    for (const heading of [
      "## When to use",
      "## Workflow",
      "## Inputs",
      "## Outputs",
      "## Constraints",
      "## Verification",
    ]) {
      expect(document.content).toContain(heading);
    }
  });
});
