import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { AgentSpawnHostContractProjection } from "../../../Source/AgentSystem/Orchestration/AgentSpawnHostContractProjection.js";
import {
  AgentSubagentRoleCatalog,
  resolveAgentSubagentBuiltinRoleDirectory,
} from "../../../Source/AgentSystem/Orchestration/AgentSubagentRoleCatalog.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

describe("subagent role catalog", () => {
  test("loads one package-declared default role with explicit workspace policy", () => {
    const catalog = new AgentSubagentRoleCatalog();
    const snapshot = catalog.snapshot(process.cwd());
    const roleIds = snapshot.roles.map((role) => role.id);

    expect(roleIds).toContain("reviewer");
    expect(roleIds).toContain("worker");
    expect(roleIds).not.toContain("review-architecture");
    expect(new Set(roleIds).size).toBe(roleIds.length);
    expect(snapshot.defaultRoleId).toBe("delegate");
    expect(snapshot.roles.filter((role) => role.isDefault)).toEqual([
      expect.objectContaining({ id: "delegate", workspaceAccess: "read_write", canDelegate: true }),
    ]);
    expect(catalog.resolveDefault(process.cwd())).toMatchObject({
      id: "delegate",
      isDefault: true,
      workspaceAccess: "read_write",
      canDelegate: true,
    });
  });

  test("projects the revisioned role catalog into the flat AgentSpawn contract", () => {
    let definitions = [subagentDefinition("reviewer", "Review a change for correctness.", true, "read_only")];
    let resourceCapabilityIds = ["workspace.path"];
    const workspaceRoot = process.cwd();
    const catalog = new AgentSubagentRoleCatalog({ discover: () => definitions });
    const projection = new AgentSpawnHostContractProjection(
      () => catalog.snapshot(workspaceRoot),
      () => resourceCapabilityIds,
    ).createProjection();
    const sourceSchema = {
      type: "object",
      properties: {
        task: { type: "string", minLength: 1 },
        agent: { type: "string", minLength: 1 },
        forkContext: { type: "boolean" },
        resources: {
          type: "array",
          items: {
            type: "object",
            properties: {
              capability: { type: "string", minLength: 1 },
              value: {},
            },
          },
        },
      },
      required: ["task"],
      additionalProperties: false,
    };

    const first = projection.projectInvocationSchema?.({} as never, sourceSchema);
    expect(first).toMatchObject({
      properties: {
        agent: { enum: ["reviewer"], default: "reviewer" },
        resources: {
          items: { properties: { capability: { enum: ["workspace.path"] } } },
        },
      },
    });
    expect(JSON.stringify(first)).not.toContain("modelProviderId");
    expect(projection.projectDescription?.({} as never, "Spawn work")).toContain(
      "reviewer (default) [read_only]: Review a change for correctness.",
    );
    expect(projection.projectInvocationSchema?.({} as never, sourceSchema)).toBe(first);

    resourceCapabilityIds = ["workspace.path", "artifact.uri"];
    const third = projection.projectInvocationSchema?.({} as never, sourceSchema);
    expect(third).not.toBe(first);
    expect(third).toMatchObject({
      properties: {
        resources: { items: { properties: { capability: { enum: ["artifact.uri", "workspace.path"] } } } },
      },
    });

    definitions = [
      ...definitions,
      subagentDefinition("scout", "Inspect a repository without changing it.", false, "read_only"),
    ];
    const second = projection.projectInvocationSchema?.({} as never, sourceSchema);
    expect(second).toMatchObject({
      properties: { agent: { enum: ["reviewer", "scout"], default: "reviewer" } },
    });
    expect(second).not.toBe(first);
  });

  test("omits resource claims when the host has no registered resource capabilities", () => {
    const catalog = new AgentSubagentRoleCatalog({
      discover: () => [subagentDefinition("reviewer", "Review a change for correctness.", true, "read_only")],
    });
    const projection = new AgentSpawnHostContractProjection(
      () => catalog.snapshot(process.cwd()),
      () => [],
    ).createProjection();
    const sourceSchema = {
      type: "object",
      properties: {
        task: { type: "string" },
        agent: { type: "string" },
        resources: {
          type: "array",
          items: { type: "object", properties: { capability: { type: "string" }, value: {} } },
        },
      },
      required: ["task"],
    };

    const projected = projection.projectInvocationSchema?.({} as never, sourceSchema);
    expect(projected?.properties).not.toHaveProperty("resources");
  });

  test("rejects role catalogs without exactly one declarative default", () => {
    const noDefault = new AgentSubagentRoleCatalog({
      discover: () => [subagentDefinition("reviewer", "Review code.", false, "read_only")],
    });
    expect(() => noDefault.snapshot(process.cwd())).toThrow("exactly one default role");

    const duplicateDefaults = new AgentSubagentRoleCatalog({
      discover: () => [
        subagentDefinition("reviewer", "Review code.", true, "read_only"),
        subagentDefinition("worker", "Implement code.", true, "read_write"),
      ],
    });
    expect(() => duplicateDefaults.snapshot(process.cwd())).toThrow("found 2: reviewer, worker");
  });

  test("keeps bundled roles structured, provider-neutral, and Skill-bound", () => {
    const catalog = new AgentSubagentRoleCatalog();
    const expectedSkills = new Map([
      ["advisor", ["evaluate-technical-decision"]],
      ["context-builder", ["investigate-repository"]],
      ["delegate", ["execute-delegated-task", "agent-orchestration"]],
      ["oracle", ["evaluate-technical-decision"]],
      ["planner", ["plan-implementation"]],
      ["researcher", ["research-primary-sources"]],
      ["reviewer", ["review-code-evidence"]],
      ["scout", ["investigate-repository"]],
      ["worker", ["implement-bounded-change"]],
    ]);

    for (const roleId of expectedSkills.keys()) {
      const role = catalog.resolve(process.cwd(), roleId);
      expect(role.skills).toEqual(expectedSkills.get(roleId));
      expect(role.systemPrompt).toContain("## Operating Principle");
      expect(role.systemPrompt).toContain("<completion>");
      expect(role.systemPrompt).toContain("## Priority");
      expect(role.systemPrompt).not.toMatch(/\b(Claude|Anthropic|Kiro|GPT-\d|training cutoff)\b/i);
    }
  });

  test("resolves the unique role catalog from package metadata instead of a named extension path", () => {
    const root = createTemporaryDirectory("senera-agent-role-contribution");
    try {
      const expected = writeRolePackage(root, "coordinate", "custom-orchestration", "roles");
      expect(resolveAgentSubagentBuiltinRoleDirectory(root)).toBe(expected);

      writeRolePackage(root, "knowledge", "second-orchestration", "roles");
      expect(() => resolveAgentSubagentBuiltinRoleDirectory(root)).toThrow(
        /Expected exactly one System extension agentRoles contribution, found 2/u,
      );
    } finally {
      removeDirectory(root);
    }
  });
});

function subagentDefinition(
  name: string,
  description: string,
  isDefault: boolean,
  workspaceAccess: "read_only" | "read_write",
) {
  return {
    id: name,
    description,
    isDefault,
    workspaceAccess,
    canDelegate: name === "delegate",
    aliases: [],
    source: "builtin" as const,
    filePath: `${process.cwd()}/${name}.md`,
    revision: `${name}-revision`,
    systemPrompt: `You are the ${name}.`,
    systemPromptMode: "replace" as const,
    inheritProjectContext: true,
    inheritSkills: false,
    skills: [],
    fallbackModels: [],
    defaultContext: "fresh" as const,
  };
}

function writeRolePackage(root: string, domain: string, id: string, rolesPath: string): string {
  const domainRoot = path.join(root, domain);
  fs.mkdirSync(domainRoot, { recursive: true });
  const domainPath = path.join(domainRoot, "domain.json");
  if (!fs.existsSync(domainPath)) {
    writeJson(domainPath, {
      schemaVersion: 1,
      id: domain,
      displayName: localized(`${domain} domain`),
      description: localized(`${domain} extension domain.`),
      presentation: {
        category: domain,
        icon: "tools",
        group: { id: domain, title: localized(`${domain} tools`) },
        activity: { action: localized(`Use ${domain}`) },
      },
    });
  }
  const packageRoot = path.join(domainRoot, id);
  fs.mkdirSync(path.join(packageRoot, rolesPath), { recursive: true });
  writeJson(path.join(packageRoot, "extension.json"), {
    schemaVersion: 1,
    id,
    domain,
    settingsSurface: "system-tools",
    version: "1.0.0",
    displayName: localized(`${id} extension`),
    description: localized(`${id} extension description.`),
    contributions: [{ kind: "agentRoles", path: rolesPath }],
  });
  return path.join(packageRoot, rolesPath);
}

function localized(value: string) {
  return { "zh-CN": value, "en-US": value };
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
