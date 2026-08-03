import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { resolveAgentWorkspaceLayout } from "../../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import { AgentManagedExtensionService } from "../../../Source/AgentSystem/ManagedExtensions/AgentManagedExtensionService.js";
import { AgentSkillScanner } from "../../../Source/AgentSystem/Skills/AgentSkillScanner.js";
import { stringifyAgentSkillDocument } from "../../../Source/AgentSystem/Skills/AgentSkillDocument.js";
import { AgentSkillValidationError } from "../../../Source/AgentSystem/Skills/AgentSkillValidationError.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) removeDirectory(temporaryDirectories.pop()!);
});

describe("managed Skill tool bindings", () => {
  test("publishes and removes a validated recommended tool binding through SkillManage", () => {
    const workspaceRoot = createWorkspace();
    const registry = { getTool: (name: string) => (name === "KnownTool" ? ({} as never) : undefined) };
    const service = new AgentManagedExtensionService(workspaceRoot, registry);

    const created = service.manageSkill({
      action: "create",
      name: "known-tool-workflow",
      description: "Use a known registered tool for a repeatable workflow.",
      instructions: "Use the registered tool and report its result.",
      recommendedTools: ["KnownTool"],
    });

    expect(created.recommendedTools).toEqual(["KnownTool"]);
    const skillPath = path.join(resolveAgentWorkspaceLayout(workspaceRoot).skillRoot, "known-tool-workflow");
    expect(new AgentSkillScanner().readSkillDirectory(skillPath).recommendedTools).toEqual(["KnownTool"]);
    expect(fs.readFileSync(path.join(skillPath, "SKILL.md"), "utf8")).toContain(
      "recommended-tools:\n      - KnownTool",
    );

    fs.writeFileSync(
      path.join(skillPath, "SKILL.md"),
      stringifyAgentSkillDocument("Use the registered tool and report its result.\n", {
        name: "known-tool-workflow",
        description: "Use a known registered tool for a repeatable workflow.",
        metadata: {
          owner: "example",
          senera: { "recommended-tools": ["KnownTool"] },
        },
      }),
      "utf8",
    );

    const updated = service.manageSkill({
      action: "update",
      name: "known-tool-workflow",
      recommendedTools: [],
    });

    expect(updated.recommendedTools).toEqual([]);
    expect(new AgentSkillScanner().readSkillDirectory(skillPath).recommendedTools).toEqual([]);
    const updatedSource = fs.readFileSync(path.join(skillPath, "SKILL.md"), "utf8");
    expect(updatedSource).toContain("owner: example");
    expect(updatedSource).not.toContain("senera:");
  });

  test("does not publish a Skill that references an unavailable tool", () => {
    const workspaceRoot = createWorkspace();
    const service = new AgentManagedExtensionService(workspaceRoot, { getTool: () => undefined });

    expect(() =>
      service.manageSkill({
        action: "create",
        name: "missing-tool-workflow",
        description: "Use a required registered tool for a repeatable workflow.",
        instructions: "Use the required tool.",
        recommendedTools: ["MissingTool"],
      }),
    ).toThrow(AgentSkillValidationError);
    expect(
      fs.existsSync(path.join(resolveAgentWorkspaceLayout(workspaceRoot).skillRoot, "missing-tool-workflow")),
    ).toBe(false);
  });

  test("reports duplicate tool declarations at their frontmatter location", () => {
    const workspaceRoot = createWorkspace();
    const skillPath = path.join(resolveAgentWorkspaceLayout(workspaceRoot).skillRoot, "duplicate-tool-workflow");
    fs.mkdirSync(skillPath, { recursive: true });
    fs.writeFileSync(
      path.join(skillPath, "SKILL.md"),
      "---\nname: duplicate-tool-workflow\ndescription: Exercise a registered tool when requested.\nmetadata:\n  senera:\n    recommended-tools:\n      - KnownTool\n      - KnownTool\n---\nUse the tool.\n",
      "utf8",
    );

    try {
      new AgentSkillScanner().readSkillDirectory(skillPath);
      throw new Error("Expected duplicate Skill tool metadata to fail validation.");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentSkillValidationError);
      if (!(error instanceof AgentSkillValidationError)) throw error;
      expect(error.diagnostics[0]).toMatchObject({
        code: "skill.frontmatter.schema",
        pointer: "/metadata/senera/recommended-tools/1",
        position: { line: 8 },
      });
    }
  });
});

function createWorkspace(): string {
  const workspaceRoot = createTemporaryDirectory("senera-managed-skill-bindings");
  temporaryDirectories.push(workspaceRoot);
  return workspaceRoot;
}
