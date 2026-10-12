import fs from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { AgentLogger } from "../../../Source/AgentSystem/Diagnostics/AgentLogger.js";
import { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { AgentMcpManagementCatalog } from "../../../Source/AgentSystem/McpPackages/AgentMcpManagementCatalog.js";
import { registerAgentSkillCatalog } from "../../../Source/AgentSystem/Skills/AgentSkillCatalogRegistration.js";
import { AgentSkillScanner } from "../../../Source/AgentSystem/Skills/AgentSkillScanner.js";
import { AgentSkillValidationError } from "../../../Source/AgentSystem/Skills/AgentSkillValidationError.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

describe("Skill resource catalog", () => {
  test("retains source diagnostics, isolates invalid packages, and publishes corrected revisions", () => {
    const root = createTemporaryDirectory("senera-skill-resource-catalog");
    try {
      const validRoot = path.join(root, "valid-skill");
      const invalidRoot = path.join(root, "invalid-skill");
      writeSkill(validRoot, "Valid instructions.");
      fs.mkdirSync(invalidRoot);
      const invalidFile = path.join(invalidRoot, "SKILL.md");
      fs.writeFileSync(invalidFile, "---\nname: invalid-skill\ndescription: []\n---\nBad metadata.");
      const scanner = new AgentSkillScanner();
      const first = scanner.scanCatalog(root);
      expect(first.skills.map((skill) => skill.name)).toEqual(["valid-skill"]);
      expect(first.skills[0]?.content).toBe("Valid instructions.");
      expect(first.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ severity: "error", filePath: invalidFile, code: "skill.frontmatter.schema" }),
        ]),
      );
      expect(scanner.scanCatalog(root)).toEqual(first);
      expect(() => scanner.scanRoot(root)).toThrow(AgentSkillValidationError);
      const registry = new AgentExtensionRegistry();
      const diagnostics = registerAgentSkillCatalog(registry, {
        systemRoot: path.join(root, "missing-system-directory"),
        workspaceRoot: root,
        systemToolBindings: new Map(),
      });
      expect(diagnostics).toEqual(first.diagnostics);
      expect(registry.listSkills().map((skill) => skill.name)).toEqual(["valid-skill"]);

      writeSkill(invalidRoot, "Corrected instructions.");
      const corrected = scanner.scanCatalog(root);
      expect(corrected.diagnostics).toEqual([]);
      expect(corrected.skills.map((skill) => skill.name)).toEqual(["invalid-skill", "valid-skill"]);
      writeSkill(validRoot, "Updated instructions.");
      const updated = scanner.scanRoot(root).find((skill) => skill.name === "valid-skill");
      expect(updated?.content).toBe("Updated instructions.");
      expect(updated?.revision).not.toBe(first.skills[0]?.revision);
      expect(first.skills[0]?.content).toBe("Valid instructions.");
    } finally {
      removeDirectory(root);
    }
  });

  test("does not let an invalid project Skill break System or MCP settings validation", () => {
    const root = createTemporaryDirectory("senera-skill-settings-catalog");
    try {
      const skillRoot = path.join(root, ".senera", "skills", "broken-skill");
      fs.mkdirSync(skillRoot, { recursive: true });
      fs.writeFileSync(path.join(skillRoot, "SKILL.md"), "---\nname: broken-skill\n---\nMissing description.");
      const logger = new AgentLogger();
      const warning = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
      const catalog = new AgentMcpManagementCatalog({ workspaceRoot: root, resourcesRoot: path.resolve(), logger });
      expect(() => catalog.validateSystemExtensions({ ModelProviders: [] })).not.toThrow();
      expect(catalog.systemSnapshot({ ModelProviders: [] }).tools.length).toBeGreaterThan(0);
      expect(warning).toHaveBeenCalledWith("resources.skills.invalid", {
        diagnostic: expect.objectContaining({ filePath: path.join(skillRoot, "SKILL.md"), severity: "error" }),
      });
    } finally {
      removeDirectory(root);
    }
  });
});

function writeSkill(root: string, content: string): void {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "SKILL.md"),
    `---\nname: ${path.basename(root)}\ndescription: Resource test.\n---\n${content}\n`,
  );
}
