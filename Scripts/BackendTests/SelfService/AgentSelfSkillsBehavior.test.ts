import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createAgentSelfSkillsPort } from "../../../Source/AgentSystem/SelfService/AgentSelfSkills.js";
import { parseAgentSelfCliCommand } from "../../../Source/AgentSystem/SelfService/AgentSelfCliParser.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-skill-self-"));
  roots.push(root);
  return root;
}

function writeSkill(root: string, name: string, content = "# Skill\n") {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "SKILL.md"),
    [`---`, `name: ${name}`, `description: Test skill for ${name}.`, `---`, "", content].join("\n"),
  );
}

describe("senera self-service Skill inventory", () => {
  test("lists, inspects, and checks registered sources", () => {
    const systemRoot = temporaryRoot();
    const workspaceRoot = temporaryRoot();
    writeSkill(systemRoot, "system-skill", "# System\n");
    writeSkill(workspaceRoot, "workspace-skill", "# Workspace\n");

    const port = createAgentSelfSkillsPort([
      { id: "system", displayName: "System", kind: "system", root: systemRoot },
      { id: "workspace", displayName: "Workspace", kind: "workspace", root: workspaceRoot },
    ]);
    expect(port.list()).toMatchObject([
      { name: "system-skill", source: { kind: "system" }, valid: true },
      { name: "workspace-skill", source: { kind: "workspace" }, valid: true },
    ]);
    expect(port.inspect("system-skill")).toMatchObject({
      status: "found",
      content: expect.stringContaining("# System\n"),
    });
    expect(port.check()).toMatchObject({ valid: true, skills: expect.any(Array), issues: [] });
  });

  test("searches bounded Skill metadata without loading the document body", () => {
    const root = temporaryRoot();
    writeSkill(root, "workspace-search", "# Search workflow\n");
    writeSkill(root, "image-workflow", "# Image workflow\n");
    const port = createAgentSelfSkillsPort([{ id: "system", displayName: "System", kind: "system", root }]);

    const matches = port.search!("search workspace", 1);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      skill: { name: "workspace-search", valid: true },
      score: expect.any(Number),
      matchedTerms: expect.any(Array),
      matchedFields: expect.any(Array),
    });
    expect(JSON.stringify(matches)).not.toContain("# Search workflow");
  });

  test("lists and reads package resources with a revision guard", () => {
    const root = temporaryRoot();
    writeSkill(root, "resource-skill", "# Body\n");
    fs.mkdirSync(path.join(root, "resource-skill", "references"), { recursive: true });
    fs.writeFileSync(path.join(root, "resource-skill", "references", "guide.md"), "Use the guide.\n");
    fs.mkdirSync(path.join(root, "resource-skill", "templates"), { recursive: true });
    fs.writeFileSync(path.join(root, "resource-skill", "templates", "card.txt"), "{{content}}\n");
    const port = createAgentSelfSkillsPort([{ id: "system", displayName: "System", kind: "system", root }]);

    const listed = port.resources("resource-skill");
    expect(listed).toMatchObject({
      status: "found",
      resources: expect.arrayContaining([expect.objectContaining({ relativePath: "SKILL.md", kind: "document" })]),
    });
    const revision = port.list()[0]?.revision;
    expect(revision).toBeTruthy();
    const read = port.readResource("resource-skill", "references/guide.md", revision);
    expect(read).toMatchObject({ status: "found", resource: { encoding: "utf8", content: "Use the guide.\n" } });
    expect(port.readResource("resource-skill", "../SKILL.md")).toMatchObject({ status: "invalid" });
    expect(port.readResource("resource-skill", "references/guide.md", "0".repeat(16))).toMatchObject({
      status: "stale",
    });
  });

  test("reports invalid documents and duplicate names instead of selecting a fallback", () => {
    const systemRoot = temporaryRoot();
    const workspaceRoot = temporaryRoot();
    writeSkill(systemRoot, "same-skill");
    writeSkill(workspaceRoot, "same-skill");
    fs.mkdirSync(path.join(workspaceRoot, "broken-skill"));
    fs.writeFileSync(path.join(workspaceRoot, "broken-skill", "SKILL.md"), "not frontmatter");

    const port = createAgentSelfSkillsPort([
      { id: "system", displayName: "System", kind: "system", root: systemRoot },
      { id: "workspace", displayName: "Workspace", kind: "workspace", root: workspaceRoot },
    ]);
    expect(port.inspect("same-skill")).toMatchObject({ status: "ambiguous" });
    expect(port.list().find((skill) => skill.name === "same-skill")).toMatchObject({ valid: false });
    expect(port.check()).toMatchObject({ valid: false });
    expect(port.check("missing")).toMatchObject({ valid: false, issues: ["Skill 不存在: missing"] });
    expect(
      port.update("same-skill", "---\nname: same-skill\ndescription: no\n---\n", "0123456789abcdef"),
    ).toMatchObject({
      status: "unavailable",
    });
  });

  test("parses Skill commands through the shared CLI registry", () => {
    expect(parseAgentSelfCliCommand(["skills", "list"])).toEqual({ command: "skills", action: "list" });
    expect(parseAgentSelfCliCommand(["skills", "search", "workspace search", "3"])).toEqual({
      command: "skills",
      action: "search",
      query: "workspace search",
      limit: 3,
    });
    expect(parseAgentSelfCliCommand(["skills", "inspect", "senera-workbench"])).toEqual({
      command: "skills",
      action: "inspect",
      name: "senera-workbench",
    });
    expect(
      parseAgentSelfCliCommand([
        "skills",
        "read",
        "senera-workbench",
        "references/cli-reference.md",
        "0123456789abcdef",
      ]),
    ).toEqual({
      command: "skills",
      action: "read",
      name: "senera-workbench",
      path: "references/cli-reference.md",
      revision: "0123456789abcdef",
    });
    expect(parseAgentSelfCliCommand(["skills", "check"])).toEqual({ command: "skills", action: "check" });
    expect(parseAgentSelfCliCommand(["skills", "history", "senera-workbench"])).toEqual({
      command: "skills",
      action: "history",
      name: "senera-workbench",
    });
    expect(parseAgentSelfCliCommand(["skills", "archive", "senera-workbench", "0123456789abcdef"])).toEqual({
      command: "skills",
      action: "archive",
      name: "senera-workbench",
      expectedRevision: "0123456789abcdef",
    });
  });

  test("mutates only the workspace source with atomic validation and restorable revisions", () => {
    const systemRoot = temporaryRoot();
    const workspaceRoot = temporaryRoot();
    const port = createAgentSelfSkillsPort([
      { id: "system", displayName: "System", kind: "system", root: systemRoot },
      { id: "workspace", displayName: "Workspace", kind: "workspace", root: workspaceRoot },
    ]);
    const first = ["---", "name: learned-rules", "description: First rules.", "---", "", "# First"].join("\n");
    const second = ["---", "name: learned-rules", "description: Second rules.", "---", "", "# Second"].join("\n");

    expect(port.create("learned-rules", first)).toMatchObject({ status: "created" });
    const created = port.list().find((skill) => skill.name === "learned-rules");
    expect(created?.valid).toBe(true);
    const updated = port.update("learned-rules", second, created?.revision);
    expect(updated).toMatchObject({ status: "updated", previousRevision: created?.revision });
    expect(port.update("learned-rules", first, created?.revision)).toMatchObject({ status: "conflict" });
    const history = port.history("learned-rules");
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ action: "update", sourceRevision: created?.revision });
    expect(port.diff("learned-rules", history[0]!.revision)).toMatchObject({
      status: "found",
      entries: expect.arrayContaining([expect.objectContaining({ path: "SKILL.md", kind: "changed" })]),
    });

    const archived = port.archive("learned-rules");
    expect(archived).toMatchObject({ status: "archived" });
    expect(port.inspect("learned-rules")).toMatchObject({ status: "missing" });
    const restored = port.restore("learned-rules", history[0]!.revision);
    expect(restored).toMatchObject({ status: "restored", restoredFrom: history[0]!.revision });
    expect(port.inspect("learned-rules")).toMatchObject({
      status: "found",
      content: expect.stringContaining("# First"),
    });
  });

  test("rejects malformed content and never writes system Skills", () => {
    const systemRoot = temporaryRoot();
    const workspaceRoot = temporaryRoot();
    const port = createAgentSelfSkillsPort([
      { id: "system", displayName: "System", kind: "system", root: systemRoot },
      { id: "workspace", displayName: "Workspace", kind: "workspace", root: workspaceRoot },
    ]);
    expect(port.create("bad-name", "not frontmatter")).toMatchObject({ status: "invalid" });
    expect(fs.existsSync(path.join(workspaceRoot, "bad-name"))).toBe(false);
    expect(port.create("../escape", "not frontmatter")).toMatchObject({ status: "invalid" });
    expect(fs.existsSync(path.join(systemRoot, "../escape"))).toBe(false);
  });
});
