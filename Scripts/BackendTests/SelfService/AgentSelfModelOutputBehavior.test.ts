import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createAgentSelfModelExecutor } from "../../../Source/AgentSystem/SelfService/AgentSelfModelExecutor.js";
import { AgentSelfCommandSchema } from "../../../Source/AgentSystem/SelfService/AgentSelfCommandSchema.js";
import {
  executeAgentSelfInvocation,
  executeAgentSelfCommand,
} from "../../../Source/AgentSystem/SelfService/AgentSelfCommand.js";
import { createAgentSelfSkillsPort } from "../../../Source/AgentSystem/SelfService/AgentSelfSkills.js";
import type {
  AgentSelfCommand,
  AgentSelfServicePort,
} from "../../../Source/AgentSystem/SelfService/AgentSelfServiceTypes.js";
import type { AgentHostToolContext } from "../../../Source/AgentSystem/ToolRuntime/AgentToolHostCapabilityRegistry.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-self-model-"));
  roots.push(root);
  return root;
}

function writeSkill(root: string, name: string, content = "# Body\n") {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "SKILL.md"),
    ["---", `name: ${name}`, `description: Test skill for ${name}.`, "---", "", content].join("\n"),
  );
}

function writeResource(root: string, name: string, relativePath: string, content: string) {
  const target = path.join(root, name, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function createSkillsPort(root: string): AgentSelfServicePort {
  return {
    workspaceRoot: root,
    config: {
      getSnapshot: () => {
        throw new Error("not used");
      },
      replace: () => {
        throw new Error("not used");
      },
      history: () => [],
      readRevision: () => ({ status: "unavailable" }) as const,
    },
    skills: createAgentSelfSkillsPort([{ id: "workspace", displayName: "Workspace", kind: "workspace", root }]),
  };
}

const toolContext: AgentHostToolContext = {
  sessionId: "test-session",
  requestId: "test-request",
  step: 0,
  approvalMode: undefined,
  signal: new AbortController().signal,
  onEvent: () => undefined,
} as unknown as AgentHostToolContext;

/** Every read-only Skill action, so a new one cannot ship without declaring
 * what the model may act on. */
const ReadActions: readonly Extract<AgentSelfCommand, { readonly command: "skills" }>[] = [
  { command: "skills", action: "list" },
  { command: "skills", action: "search", query: "guide", limit: 5 },
  { command: "skills", action: "inspect", name: "resource-skill" },
  { command: "skills", action: "resources", name: "resource-skill" },
  { command: "skills", action: "read", name: "resource-skill", path: "references/guide.md" },
  { command: "skills", action: "diff", name: "resource-skill", revision: "0".repeat(64) },
  { command: "skills", action: "check", name: "resource-skill" },
  { command: "skills", action: "history", name: "resource-skill" },
];

describe("Session-scoped CLI model-facing Skill output", () => {
  test("keeps the document as text and one revision, and drops the duplicated payload", async () => {
    const root = temporaryRoot();
    writeSkill(root, "resource-skill");
    writeResource(root, "resource-skill", path.join("references", "guide.md"), "Use the guide.\n");
    const execute = createAgentSelfModelExecutor(createSkillsPort(root));

    const parsed = AgentSelfCommandSchema.parse({
      command: "skills",
      action: "read",
      name: "resource-skill",
      path: "references/guide.md",
    });
    const output = await execute(parsed, toolContext);

    expect(output.text).toBe("Use the guide.\n");
    expect(output.revision).toMatch(/^[0-9a-f]{64}$/u);
    expect(output.data).toBeUndefined();
    expect(JSON.stringify(output)).not.toContain("descriptionFile");
    expect(JSON.stringify(output)).not.toContain("resourceCount");
  });

  test("projects the Skill catalog without host paths or duplicated revisions", async () => {
    const root = temporaryRoot();
    writeSkill(root, "catalog-skill");
    const execute = createAgentSelfModelExecutor(createSkillsPort(root));

    const parsed = AgentSelfCommandSchema.parse({ command: "skills", action: "list" });
    const output = await execute(parsed, toolContext);

    expect(output.text).toContain("catalog-skill");
    expect(output.data).toEqual({
      skills: [{ name: "catalog-skill", description: "Test skill for catalog-skill.", recommendedTools: [] }],
    });
    expect(JSON.stringify(output)).not.toContain("descriptionFile");
    expect(JSON.stringify(output)).not.toContain("resourceCount");
  });

  test("keeps the resource inventory of an inspected Skill and a single revision", async () => {
    const root = temporaryRoot();
    writeSkill(root, "inspect-skill");
    writeResource(root, "inspect-skill", path.join("references", "guide.md"), "Use the guide.\n");
    const execute = createAgentSelfModelExecutor(createSkillsPort(root));

    const parsed = AgentSelfCommandSchema.parse({ command: "skills", action: "inspect", name: "inspect-skill" });
    const output = await execute(parsed, toolContext);

    expect(output.revision).toMatch(/^[0-9a-f]{64}$/u);
    expect(output.data).toMatchObject({
      skill: { name: "inspect-skill" },
      resources: expect.arrayContaining([
        expect.objectContaining({ relativePath: "references/guide.md", kind: "reference" }),
      ]),
    });
    expect(JSON.stringify(output)).not.toContain("descriptionFile");
  });

  test("returns the revision a follow-up mutation has to quote", async () => {
    const root = temporaryRoot();
    writeSkill(root, "mutable-skill");
    const port = createSkillsPort(root);

    const listed = await executeAgentSelfCommand({ command: "skills", action: "list" }, port);
    const revision = listed.text.match(/revision ([0-9a-f]{64})/u)?.[1];
    expect(revision).toBeTruthy();
    if (!revision) throw new Error("The Skill catalog did not expose a revision.");

    const updated = await executeAgentSelfCommand(
      {
        command: "skills",
        action: "update",
        name: "mutable-skill",
        content: ["---", "name: mutable-skill", "description: Updated.", "---", "", "# Updated\n"].join("\n"),
        expectedRevision: revision,
      },
      port,
      {
        approvals: {
          async request() {
            return { status: "approved" };
          },
        },
      },
    );
    expect(updated.ok).toBe(true);
    expect(updated.data).toMatchObject({ status: "updated" });
    expect(updated.model?.revision).toMatch(/^[0-9a-f]{64}$/u);
    expect(updated.model?.revision).not.toBe(revision);
    expect(updated.model?.data).toBeUndefined();
  });

  test("projects the model result while preserving the complete result for administrative callers", async () => {
    const root = temporaryRoot();
    writeSkill(root, "durable-skill");
    const port = createSkillsPort(root);
    const invocation = AgentSelfCommandSchema.parse({
      command: "skills",
      action: "read",
      name: "durable-skill",
      path: "SKILL.md",
    });

    const complete = await executeAgentSelfInvocation(invocation, port);
    expect(complete.data).toMatchObject({ resource: { content: expect.stringContaining("# Body") } });

    const execute = createAgentSelfModelExecutor(port);
    const projected = await execute(invocation, toolContext);
    expect(projected).toMatchObject({ ok: true, text: expect.stringContaining("# Body") });
    expect(projected.data).toBeUndefined();
  });

  test("keeps the candidates the model has to choose from when a name is ambiguous", async () => {
    const systemRoot = temporaryRoot();
    const workspaceRoot = temporaryRoot();
    writeSkill(systemRoot, "same-skill");
    writeSkill(workspaceRoot, "same-skill");
    const execute = createAgentSelfModelExecutor({
      workspaceRoot: workspaceRoot,
      config: {
        getSnapshot: () => {
          throw new Error("not used");
        },
        replace: () => {
          throw new Error("not used");
        },
        history: () => [],
        readRevision: () => ({ status: "unavailable" }) as const,
      },
      skills: createAgentSelfSkillsPort([
        { id: "system", displayName: "System", kind: "system", root: systemRoot },
        { id: "workspace", displayName: "Workspace", kind: "workspace", root: workspaceRoot },
      ]),
    });

    const output = await execute(
      AgentSelfCommandSchema.parse({ command: "skills", action: "inspect", name: "same-skill" }),
      toolContext,
    );
    expect(output.ok).toBe(false);
    expect(output.error).toBe("skill_ambiguous");
    expect(output.data).toEqual({
      candidates: [
        { name: "same-skill", description: "Test skill for same-skill.", recommendedTools: [], source: "System" },
        { name: "same-skill", description: "Test skill for same-skill.", recommendedTools: [], source: "Workspace" },
      ],
    });
    expect(JSON.stringify(output)).not.toContain("descriptionFile");
  });

  test("declares a model slice for every Skill action", async () => {
    const root = temporaryRoot();
    writeSkill(root, "resource-skill");
    writeResource(root, "resource-skill", path.join("references", "guide.md"), "Use the guide.\n");
    const port = createSkillsPort(root);

    for (const invocation of ReadActions) {
      const output = await executeAgentSelfCommand(invocation, port);
      expect(output.model, `${invocation.action} did not declare a model slice`).toBeDefined();
    }
  });

  test("leaves a command outside the Skill surface untouched", async () => {
    const root = temporaryRoot();
    writeSkill(root, "untouched-skill");
    const port = createSkillsPort(root);

    const complete = await executeAgentSelfCommand({ command: "capabilities" }, port);
    expect(complete.model).toBeUndefined();
    expect(complete.data).toBeDefined();

    const execute = createAgentSelfModelExecutor(port);
    const output = await execute(AgentSelfCommandSchema.parse({ command: "capabilities" }), toolContext);
    expect(output.data).toEqual(complete.data);
  });
});
