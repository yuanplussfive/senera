import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { SeneraLocalExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import type { SeneraExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraExecutionTypes.js";
import { applyWorkspacePatchHostTool } from "../../../Source/AgentSystem/ToolRuntime/AgentWorkspaceApplyPatchRuntime.js";
import type { AgentHostToolContext } from "../../../Source/AgentSystem/ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { AgentManagedExtensionService } from "../../../Source/AgentSystem/ManagedExtensions/AgentManagedExtensionService.js";
import { AgentSkillScanner } from "../../../Source/AgentSystem/Skills/AgentSkillScanner.js";
import { resolveAgentWorkspaceLayout } from "../../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import { createSeneraExecutionEnvironments } from "../../../Source/AgentSystem/Execution/SeneraExecutionEnvFactory.js";
import { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { AgentSeneraOpaPolicyClient } from "../../../Source/AgentSystem/Safety/AgentSeneraOpaPolicyClient.js";
import { AgentResourceAccessPolicy } from "../../../Source/AgentSystem/Safety/AgentResourceAccessPolicy.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) removeDirectory(temporaryDirectories.pop()!);
});

describe("Workspace apply patch runtime behavior", () => {
  test("replaces a whole file when its expected SHA-256 still matches", async () => {
    const workspaceRoot = createWorkspace();
    const target = path.join(workspaceRoot, "value.txt");
    await fs.writeFile(target, "before\n", "utf8");

    const result = await applyWorkspacePatchHostTool(
      {
        operations: [
          {
            kind: "replace",
            path: "value.txt",
            content: "after\n",
            expectedSha256: digest("before\n"),
          },
        ],
      },
      context(workspaceRoot),
    );

    expect(result.response.ok).toBe(true);
    expect(await fs.readFile(target, "utf8")).toBe("after\n");
  });

  test("rejects a stale expected SHA-256 without changing the file", async () => {
    const workspaceRoot = createWorkspace();
    const target = path.join(workspaceRoot, "value.txt");
    await fs.writeFile(target, "current\n", "utf8");

    const result = await applyWorkspacePatchHostTool(
      {
        operations: [
          {
            kind: "replace",
            path: "value.txt",
            content: "after\n",
            expectedSha256: digest("stale\n"),
          },
        ],
      },
      context(workspaceRoot),
    );

    expect(result.response.ok).toBe(false);
    expect(await fs.readFile(target, "utf8")).toBe("current\n");
  });

  test("revalidates planned source files immediately before committing", async () => {
    const workspaceRoot = createWorkspace();
    const target = path.join(workspaceRoot, "value.txt");
    await fs.writeFile(target, "before\n", "utf8");
    const base = new SeneraLocalExecutionEnv({ workspaceRoot });
    let mutated = false;
    const executionEnv = new Proxy(base, {
      get(instance, property, receiver) {
        if (property === "readTextFile") {
          return async (...args: Parameters<SeneraExecutionEnv["readTextFile"]>) => {
            const result = await instance.readTextFile(...args);
            if (!mutated) {
              mutated = true;
              await fs.writeFile(target, "concurrent\n", "utf8");
            }
            return result;
          };
        }
        const value = Reflect.get(instance, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(instance) : value;
      },
    });

    const result = await applyWorkspacePatchHostTool(
      {
        operations: [
          {
            kind: "update",
            path: "value.txt",
            patch: "@@ -1,1 +1,1 @@\n-before\n+after",
          },
        ],
      },
      context(workspaceRoot, executionEnv),
    );

    expect(result.response.ok).toBe(false);
    expect(await fs.readFile(target, "utf8")).toBe("concurrent\n");
  });

  test("binds the rollback snapshot to the validated file revision", async () => {
    const workspaceRoot = createWorkspace();
    const target = path.join(workspaceRoot, "value.txt");
    await fs.writeFile(target, "before\n", "utf8");
    const base = new SeneraLocalExecutionEnv({ workspaceRoot });
    let binaryReadCount = 0;
    const executionEnv = new Proxy(base, {
      get(instance, property, receiver) {
        if (property === "readBinaryFile") {
          return async (...args: Parameters<SeneraExecutionEnv["readBinaryFile"]>) => {
            const result = await instance.readBinaryFile(...args);
            binaryReadCount += 1;
            if (binaryReadCount === 2) await fs.writeFile(target, "between-validation-and-snapshot\n", "utf8");
            return result;
          };
        }
        const value = Reflect.get(instance, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(instance) : value;
      },
    });

    const result = await applyWorkspacePatchHostTool(
      {
        operations: [{ kind: "replace", path: "value.txt", content: "after\n" }],
      },
      context(workspaceRoot, executionEnv),
    );

    expect(result.response.ok).toBe(false);
    expect(await fs.readFile(target, "utf8")).toBe("between-validation-and-snapshot\n");
  });

  test("rolls back earlier files when a later write fails", async () => {
    const workspaceRoot = createWorkspace();
    const first = path.join(workspaceRoot, "first.txt");
    const second = path.join(workspaceRoot, "second.txt");
    await fs.writeFile(first, "first-before\n", "utf8");
    await fs.writeFile(second, "second-before\n", "utf8");
    const base = new SeneraLocalExecutionEnv({ workspaceRoot });
    let writeCount = 0;
    const executionEnv = new Proxy(base, {
      get(instance, property, receiver) {
        if (property === "writeFile") {
          return async (...args: Parameters<SeneraExecutionEnv["writeFile"]>) => {
            writeCount += 1;
            if (writeCount === 2) return { ok: false, error: new Error("injected write failure") } as never;
            return instance.writeFile(...args);
          };
        }
        const value = Reflect.get(instance, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(instance) : value;
      },
    });

    const result = await applyWorkspacePatchHostTool(
      {
        operations: [
          { kind: "replace", path: "first.txt", content: "first-after\n" },
          { kind: "replace", path: "second.txt", content: "second-after\n" },
        ],
      },
      context(workspaceRoot, executionEnv),
    );

    expect(result.response.ok).toBe(false);
    expect(await fs.readFile(first, "utf8")).toBe("first-before\n");
    expect(await fs.readFile(second, "utf8")).toBe("second-before\n");
  });

  test("rejects an invalid Skill candidate before changing the live directory", async () => {
    const workspaceRoot = createWorkspace();
    const service = new AgentManagedExtensionService(workspaceRoot, { getTool: () => undefined });
    service.manageSkill({
      action: "create",
      name: "patch-gated-skill",
      description: "Valid before the rejected patch.",
      instructions: "Run the stable workflow.",
    });
    const skillRoot = resolveAgentWorkspaceLayout(workspaceRoot).skillRoot;
    const skillRelativeRoot = path.relative(workspaceRoot, skillRoot).split(path.sep).join("/");
    const skillFile = path.join(skillRoot, "patch-gated-skill", "SKILL.md");
    const original = await fs.readFile(skillFile, "utf8");
    const beforeRevision = AgentSkillScanner.sourceRevision(skillRoot);

    const result = await applyWorkspacePatchHostTool(
      {
        operations: [
          {
            kind: "replace",
            path: `${skillRelativeRoot}/patch-gated-skill/SKILL.md`,
            content: "---\nname: patch-gated-skill\n---\nIncomplete candidate.\n",
          },
        ],
      },
      context(workspaceRoot),
    );

    expect(result.response.ok).toBe(false);
    if (result.response.ok) throw new Error("Expected Skill preflight failure.");
    const processError = result.response.error;
    if (!processError) throw new Error("Expected Skill preflight diagnostics.");
    expect(processError.details).toMatchObject({
      requestId: "request-extension-gate",
      extensionKind: "Skill",
      extensionName: "patch-gated-skill",
      attempt: {
        state: "validation-failed",
        activeChanged: false,
        operationCount: 1,
        changedPaths: [`${skillRelativeRoot}/patch-gated-skill/SKILL.md`],
        extension: { kind: "Skill", name: "patch-gated-skill" },
      },
    });
    expect(processError.diagnostics?.[0]).toMatchObject({
      filePath: skillFile,
      pointer: "/description",
      frame: { text: expect.stringContaining("^") },
    });
    expect(await fs.readFile(skillFile, "utf8")).toBe(original);
    expect(AgentSkillScanner.sourceRevision(skillRoot)).toBe(beforeRevision);
  });

  test("atomically creates and validates a Toolkit Skill with previously missing resource directories", async () => {
    const workspaceRoot = createWorkspace();
    const skillRoot = resolveAgentWorkspaceLayout(workspaceRoot).skillRoot;
    const skillRelativeRoot = path.relative(workspaceRoot, skillRoot).split(path.sep).join("/");
    const result = await applyWorkspacePatchHostTool(
      {
        operations: [
          { kind: "createDirectory", path: `${skillRelativeRoot}/csv-columns` },
          { kind: "createDirectory", path: `${skillRelativeRoot}/csv-columns/scripts` },
          {
            kind: "add",
            path: `${skillRelativeRoot}/csv-columns/SKILL.md`,
            content:
              "---\nname: csv-columns\ndescription: Extract named columns from CSV files deterministically.\n---\nRun scripts/select.mjs.\n",
          },
          {
            kind: "add",
            path: `${skillRelativeRoot}/csv-columns/scripts/select.mjs`,
            content: "export default function selectColumns(rows) { return rows; }\n",
          },
        ],
      },
      context(workspaceRoot, governedExecutionEnv(workspaceRoot)),
    );

    expect(result.response.ok).toBe(true);
    if (!result.response.ok) throw new Error("Expected a valid Skill patch result.");
    expect(result.response.result).toMatchObject({
      extensions: [
        {
          kind: "Skill",
          name: "csv-columns",
          status: "validated",
        },
      ],
    });
    const skills = new AgentSkillScanner().scanRoot(skillRoot);
    expect(skills[0]?.description).toBe("Extract named columns from CSV files deterministically.");
    expect(await fs.readFile(path.join(skillRoot, "csv-columns", "scripts", "select.mjs"), "utf8")).toContain(
      "selectColumns",
    );
  });

  test("rejects a Skill tool binding that is absent from the registered tool catalog", async () => {
    const workspaceRoot = createWorkspace();
    const skillRoot = resolveAgentWorkspaceLayout(workspaceRoot).skillRoot;
    const skillRelativeRoot = path.relative(workspaceRoot, skillRoot).split(path.sep).join("/");
    const result = await applyWorkspacePatchHostTool(
      {
        operations: [
          { kind: "createDirectory", path: `${skillRelativeRoot}/missing-tool-skill` },
          {
            kind: "add",
            path: `${skillRelativeRoot}/missing-tool-skill/SKILL.md`,
            content:
              "---\nname: missing-tool-skill\ndescription: Exercise a registered tool when explicitly requested.\nmetadata:\n  senera:\n    recommended-tools:\n      - MissingTool\n---\nUse the registered tool.\n",
          },
        ],
      },
      context(workspaceRoot),
    );

    expect(result.response.ok).toBe(false);
    if (result.response.ok) throw new Error("Expected missing Skill tool reference to fail preflight.");
    expect(result.response.error?.diagnostics?.[0]).toMatchObject({
      code: "skill.metadata.senera.recommendedToolMissing",
      pointer: "/metadata/senera/recommended-tools/0",
      position: { line: 7 },
      frame: { text: expect.stringContaining("MissingTool") },
    });
    await expect(fs.stat(path.join(skillRoot, "missing-tool-skill"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("atomically creates and validates a workspace MCP package", async () => {
    const workspaceRoot = createWorkspace();
    const mcpRoot = resolveAgentWorkspaceLayout(workspaceRoot).mcpRoot;
    const mcpRelativeRoot = path.relative(workspaceRoot, mcpRoot).split(path.sep).join("/");

    const result = await applyWorkspacePatchHostTool(
      {
        operations: [
          { kind: "createDirectory", path: `${mcpRelativeRoot}/csv-toolkit` },
          { kind: "createDirectory", path: `${mcpRelativeRoot}/csv-toolkit/mcp` },
          {
            kind: "add",
            path: `${mcpRelativeRoot}/csv-toolkit/.mcp.json`,
            content: `${JSON.stringify(
              {
                execution: { targets: ["local"], preferred: "local" },
                mcpServers: {
                  "csv-toolkit": { type: "stdio", command: "node", args: ["./mcp/server.mjs"], cwd: "." },
                },
              },
              null,
              2,
            )}\n`,
          },
          {
            kind: "add",
            path: `${mcpRelativeRoot}/csv-toolkit/mcp/server.mjs`,
            content: "export const packageName = 'csv-toolkit';\n",
          },
        ],
      },
      context(workspaceRoot, governedExecutionEnv(workspaceRoot)),
    );

    expect(result.response.ok).toBe(true);
    if (!result.response.ok) throw new Error("Expected a valid MCP package patch result.");
    expect(result.response.result).toMatchObject({
      extensions: [{ kind: "MCP", name: "csv-toolkit", status: "validated" }],
    });
    await expect(fs.readFile(path.join(mcpRoot, "csv-toolkit", ".mcp.json"), "utf8")).resolves.toContain("csv-toolkit");
  });

  test("rejects an invalid MCP candidate before changing the live directory", async () => {
    const workspaceRoot = createWorkspace();
    const mcpRoot = resolveAgentWorkspaceLayout(workspaceRoot).mcpRoot;
    const mcpRelativeRoot = path.relative(workspaceRoot, mcpRoot).split(path.sep).join("/");

    const result = await applyWorkspacePatchHostTool(
      {
        operations: [
          { kind: "createDirectory", path: `${mcpRelativeRoot}/broken-toolkit` },
          {
            kind: "add",
            path: `${mcpRelativeRoot}/broken-toolkit/.mcp.json`,
            content: `${JSON.stringify({ mcpServers: { broken: { type: "stdio", command: "node" } } }, null, 2)}\n`,
          },
        ],
      },
      context(workspaceRoot),
    );

    expect(result.response.ok).toBe(false);
    if (result.response.ok) throw new Error("Expected MCP preflight failure.");
    expect(result.response.error?.details).toMatchObject({
      extensionKind: "MCP",
      extensionName: "broken-toolkit",
    });
    expect(result.response.error?.diagnostics?.[0]).toMatchObject({
      filePath: path.join(mcpRoot, "broken-toolkit", ".mcp.json"),
      pointer: "/execution",
    });
    await expect(fs.stat(path.join(mcpRoot, "broken-toolkit"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("keeps host state protected when the production resource policy is active", async () => {
    const workspaceRoot = createWorkspace();
    const result = await applyWorkspacePatchHostTool(
      {
        operations: [{ kind: "add", path: ".senera/data/host-state.txt", content: "blocked\n" }],
      },
      context(workspaceRoot, governedExecutionEnv(workspaceRoot)),
    );

    expect(result.response.ok).toBe(false);
    await expect(fs.stat(path.join(workspaceRoot, ".senera", "data", "host-state.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("rolls back a validated Skill when another path in the transaction is protected", async () => {
    const workspaceRoot = createWorkspace();
    const result = await applyWorkspacePatchHostTool(
      {
        operations: [
          { kind: "createDirectory", path: ".senera/skills/atomic-policy" },
          {
            kind: "add",
            path: ".senera/skills/atomic-policy/SKILL.md",
            content:
              "---\nname: atomic-policy\ndescription: Verify policy rollback for a mixed workspace transaction.\n---\nRun the workflow.\n",
          },
          { kind: "add", path: ".senera/data/blocked.txt", content: "blocked\n" },
        ],
      },
      context(workspaceRoot, governedExecutionEnv(workspaceRoot)),
    );

    expect(result.response.ok).toBe(false);
    await expect(fs.stat(path.join(workspaceRoot, ".senera", "skills", "atomic-policy"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(fs.stat(path.join(workspaceRoot, ".senera", "data", "blocked.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("does not allow a validated publication scope to mutate a managed collection root", async () => {
    const workspaceRoot = createWorkspace();
    const skillRoot = resolveAgentWorkspaceLayout(workspaceRoot).skillRoot;
    await fs.mkdir(skillRoot, { recursive: true });
    const result = await applyWorkspacePatchHostTool(
      {
        operations: [{ kind: "deleteDirectory", path: ".senera/skills", recursive: true }],
      },
      context(workspaceRoot, governedExecutionEnv(workspaceRoot)),
    );

    expect(result.response.ok).toBe(false);
    expect((await fs.stat(skillRoot)).isDirectory()).toBe(true);
  });
});

function createWorkspace(): string {
  const workspace = createTemporaryDirectory("senera-workspace-patch");
  temporaryDirectories.push(workspace);
  return workspace;
}

function governedExecutionEnv(workspaceRoot: string): SeneraExecutionEnv {
  const registry = new AgentExtensionRegistry();
  const policy = new AgentResourceAccessPolicy(new AgentSeneraOpaPolicyClient({ registry }));
  return createSeneraExecutionEnvironments({ workspaceRoot, resourceAccessPolicy: policy }).tool;
}

function context(
  workspaceRoot: string,
  executionEnv: SeneraExecutionEnv = new SeneraLocalExecutionEnv({ workspaceRoot }),
  config: AgentHostToolContext["config"] = { ModelProviders: [] },
) {
  return {
    workspaceRoot,
    executionEnv,
    tool: {
      name: "WorkspaceApplyPatch",
      runtime: { Lifecycle: "Immediate", ProtocolVersion: 2, Capabilities: { Progress: true } },
    },
    config,
    requestId: "request-extension-gate",
    registry: { getTool: () => undefined },
  } as unknown as AgentHostToolContext;
}

function digest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
