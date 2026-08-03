import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { AgentSkillScanner } from "../../../Source/AgentSystem/Skills/AgentSkillScanner.js";
import { resolveAgentWorkspaceLayout } from "../../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import { parseMarkdownSections } from "../../../Source/AgentSystem/Prompt/AgentMarkdownSections.js";

describe("Skill creation examples", () => {
  test("keeps one prompt-only example and one executable Toolkit example", () => {
    const workspaceRoot = process.cwd();
    const scanner = new AgentSkillScanner();
    const skillRoot = resolveAgentWorkspaceLayout(workspaceRoot).skillRoot;
    const workflow = scanner.readSkillDirectory(path.join(skillRoot, "workflow-skill-example"));
    const toolkit = scanner.readSkillDirectory(path.join(skillRoot, "json-field-selector"));

    expect(workflow.name).toBe("workflow-skill-example");
    expect(toolkit.name).toBe("json-field-selector");
    expect(workflow.recommendedTools).toEqual(["ShellCommandTool"]);
    expect(toolkit.recommendedTools).toEqual(["ShellCommandTool"]);

    const toolkitRoot = path.dirname(toolkit.descriptionFile);
    const output = execFileSync(
      process.execPath,
      [path.join(toolkitRoot, "scripts", "select-fields.mjs"), path.join(workspaceRoot, "package.json"), "name"],
      { encoding: "utf8" },
    );
    expect(JSON.parse(output)).toEqual({ name: "senera" });
    expect(fs.readFileSync(toolkit.descriptionFile, "utf8")).not.toContain("JsonPickTool");
    expect(fs.readFileSync(toolkit.descriptionFile, "utf8")).toContain("JSON_FIELD_SELECTOR_SKILL_EOF");
    expect(fs.readFileSync(workflow.descriptionFile, "utf8")).not.toContain("SKILL_EOF");
  });

  test("documents atomic Toolkit resource creation and nested write preconditions", () => {
    const skillCreator = fs.readFileSync(path.resolve("System/Skills/skill-creator/SKILL.md"), "utf8");
    expect(skillCreator).toContain("one atomic `WorkspaceApplyPatch` call");
    expect(skillCreator).toContain("`createDirectory`");
    expect(skillCreator).toContain("`add`");
    expect(skillCreator).toContain("does not create missing parent directories");
    expect(skillCreator).toContain("optional author-owned EOF comment");
  });

  test("reads documentation sections from Markdown structure without treating fenced examples as headings", () => {
    const document = parseMarkdownSections(
      [
        "# Tool Documentation",
        "",
        "## Summary",
        "Projects selected fields.",
        "",
        "```markdown",
        "## Trigger",
        "This heading is example content.",
        "```",
        "",
        "## Trigger",
        "Use for deterministic projection.",
      ].join("\n"),
    );

    expect(document.title).toBe("Tool Documentation");
    expect(document.sections.get("Summary")).toContain("This heading is example content.");
    expect(document.sections.get("Trigger")).toBe("Use for deterministic projection.");
  });
});
