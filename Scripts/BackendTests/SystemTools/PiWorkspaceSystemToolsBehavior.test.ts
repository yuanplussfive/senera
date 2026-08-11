import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { createReadTool as createPiReadTool } from "@earendil-works/pi-agent-core";
import {
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { SeneraLocalExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import type { AgentSystemToolDefinition } from "../../../Source/AgentSystem/SystemTools/AgentSystemToolDefinition.js";
import {
  PiWorkspaceSystemTools,
  WorkspaceFindSystemTool,
  WorkspaceGrepSystemTool,
  WorkspaceListSystemTool,
  WorkspaceReadSystemTool,
} from "../../../Source/AgentSystem/SystemTools/PiWorkspaceSystemTools.js";
import type { AgentHostToolContext } from "../../../Source/AgentSystem/ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Pi workspace System Tools", () => {
  test("derives every invocation contract from Pi's public parameter schema", () => {
    const piSchemas = [
      createPiReadTool().parameters,
      createGrepToolDefinition(".").parameters,
      createFindToolDefinition(".").parameters,
      createLsToolDefinition(".").parameters,
    ];

    expect(PiWorkspaceSystemTools).toHaveLength(piSchemas.length);
    for (const [index, definition] of PiWorkspaceSystemTools.entries()) {
      const expected = z.fromJSONSchema(piSchemas[index]! as unknown as Parameters<typeof z.fromJSONSchema>[0]);
      expect(z.toJSONSchema(definition.input, { target: "draft-7", io: "input" })).toEqual(
        z.toJSONSchema(expected, { target: "draft-7", io: "input" }),
      );
      expect(definition.metadata.execution).toEqual({ Targets: ["Local"], Network: "Deny", Workspace: "ReadOnly" });
      expect(definition.metadata.runtime).toMatchObject({
        Scheduling: "Parallel",
        Capabilities: { Cancellation: true },
      });
    }
  });

  test("reads through Senera's canonical workspace boundary and preserves Pi continuation guidance", async () => {
    const workspaceRoot = createWorkspace();
    fs.writeFileSync(path.join(workspaceRoot, "notes.txt"), "alpha\nbeta\ngamma", "utf8");

    const result = await WorkspaceReadSystemTool.execute(
      { path: "notes.txt", offset: 2, limit: 1 },
      hostContext(WorkspaceReadSystemTool, workspaceRoot),
    );

    expect(textContent(result)).toContain("beta");
    expect(textContent(result)).toContain("Use offset=3 to continue");
  });

  test("rejects absolute and linked paths that escape the workspace", async () => {
    const root = createRoot();
    const workspaceRoot = path.join(root, "workspace");
    const outsideRoot = path.join(root, "outside");
    fs.mkdirSync(workspaceRoot);
    fs.mkdirSync(outsideRoot);
    fs.writeFileSync(path.join(outsideRoot, "secret.txt"), "outside", "utf8");
    fs.symlinkSync(outsideRoot, path.join(workspaceRoot, "escape"), process.platform === "win32" ? "junction" : "dir");

    await expect(
      WorkspaceReadSystemTool.execute(
        { path: path.join(outsideRoot, "secret.txt") },
        hostContext(WorkspaceReadSystemTool, workspaceRoot),
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await expect(
      WorkspaceListSystemTool.execute({ path: "escape" }, hostContext(WorkspaceListSystemTool, workspaceRoot)),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await expect(
      WorkspaceGrepSystemTool.execute(
        { pattern: "outside", path: "escape" },
        hostContext(WorkspaceGrepSystemTool, workspaceRoot),
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await expect(
      WorkspaceFindSystemTool.execute(
        { pattern: "*.txt", path: "escape" },
        hostContext(WorkspaceFindSystemTool, workspaceRoot),
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });

  test("searches with bundled ripgrep while respecting hidden files and git ignores", async () => {
    const workspaceRoot = createWorkspace();
    fs.mkdirSync(path.join(workspaceRoot, ".git"));
    fs.writeFileSync(path.join(workspaceRoot, ".gitignore"), "ignored.ts\n", "utf8");
    fs.writeFileSync(path.join(workspaceRoot, "visible.ts"), "const marker = 'needle';\n", "utf8");
    fs.writeFileSync(path.join(workspaceRoot, ".hidden.ts"), "const hidden = 'needle';\n", "utf8");
    fs.writeFileSync(path.join(workspaceRoot, "ignored.ts"), "const ignored = 'needle';\n", "utf8");

    const result = await WorkspaceGrepSystemTool.execute(
      { pattern: "needle", path: ".", literal: true },
      hostContext(WorkspaceGrepSystemTool, workspaceRoot),
    );
    const output = textContent(result);

    expect(output).toContain("visible.ts:1:");
    expect(output).toContain(".hidden.ts:1:");
    expect(output).not.toContain("ignored.ts");
  });

  test("finds files with nested ignore semantics and preserves Pi's result-limit metadata", async () => {
    const workspaceRoot = createWorkspace();
    fs.mkdirSync(path.join(workspaceRoot, "nested"));
    fs.mkdirSync(path.join(workspaceRoot, "node_modules"));
    fs.writeFileSync(path.join(workspaceRoot, "nested", ".gitignore"), "ignored.ts\n", "utf8");
    fs.writeFileSync(path.join(workspaceRoot, ".hidden.ts"), "hidden", "utf8");
    fs.writeFileSync(path.join(workspaceRoot, "nested", "visible.ts"), "visible", "utf8");
    fs.writeFileSync(path.join(workspaceRoot, "nested", "ignored.ts"), "ignored", "utf8");
    fs.writeFileSync(path.join(workspaceRoot, "node_modules", "dependency.ts"), "dependency", "utf8");

    const complete = await WorkspaceFindSystemTool.execute(
      { pattern: "*.ts", path: "." },
      hostContext(WorkspaceFindSystemTool, workspaceRoot),
    );
    expect(textContent(complete)).toContain(".hidden.ts");
    expect(textContent(complete)).toContain("nested/visible.ts");
    expect(textContent(complete)).not.toContain("nested/ignored.ts");
    expect(textContent(complete)).not.toContain("node_modules/dependency.ts");

    const limited = await WorkspaceFindSystemTool.execute(
      { pattern: "*.ts", path: ".", limit: 1 },
      hostContext(WorkspaceFindSystemTool, workspaceRoot),
    );
    expect(limited.details).toMatchObject({ resultLimitReached: 1 });
    expect(textContent(limited)).toContain("1 results limit reached");
  });

  test("lists dotfiles and directory suffixes in Pi's stable order", async () => {
    const workspaceRoot = createWorkspace();
    fs.mkdirSync(path.join(workspaceRoot, "folder"));
    fs.writeFileSync(path.join(workspaceRoot, ".env"), "", "utf8");
    fs.writeFileSync(path.join(workspaceRoot, "beta.txt"), "", "utf8");
    fs.writeFileSync(path.join(workspaceRoot, "Alpha.txt"), "", "utf8");

    const result = await WorkspaceListSystemTool.execute(
      { path: "." },
      hostContext(WorkspaceListSystemTool, workspaceRoot),
    );
    const entries = textContent(result).split("\n");

    expect(entries).toContain(".env");
    expect(entries).toContain("folder/");
    expect(entries.indexOf("Alpha.txt")).toBeLessThan(entries.indexOf("beta.txt"));
  });

  test("honors cancellation before starting local file work", async () => {
    const workspaceRoot = createWorkspace();
    const abort = new AbortController();
    abort.abort(new Error("cancelled by test"));

    await expect(
      WorkspaceFindSystemTool.execute(
        { pattern: "*", path: "." },
        hostContext(WorkspaceFindSystemTool, workspaceRoot, abort.signal),
      ),
    ).rejects.toThrow("cancelled by test");
  });
});

function createWorkspace(): string {
  const root = createRoot();
  const workspaceRoot = path.join(root, "workspace");
  fs.mkdirSync(workspaceRoot);
  return workspaceRoot;
}

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-pi-workspace-tools-"));
  temporaryRoots.push(root);
  return root;
}

function hostContext(
  definition: AgentSystemToolDefinition,
  workspaceRoot: string,
  signal?: AbortSignal,
): AgentHostToolContext {
  const tool = registeredTool(definition, workspaceRoot);
  return {
    tool,
    config: { ModelProviders: [] },
    workspaceRoot,
    registry: { getTool: (name) => (name === tool.name ? tool : undefined), listTools: () => [tool] },
    executionEnv: new SeneraLocalExecutionEnv({ workspaceRoot }),
    toolCallId: `call-${definition.name}`,
    signal,
  };
}

function registeredTool(definition: AgentSystemToolDefinition, workspaceRoot: string): RegisteredTool {
  return {
    owner: {
      kind: "system",
      name: definition.extension.name,
      title: definition.extension.displayName["en-US"],
      description: definition.extension.description["en-US"],
      rootPath: workspaceRoot,
      revision: "test",
      trusted: true,
      requiresApproval: false,
    },
    name: definition.name,
    loading: "Bootstrap",
    permissions: [...(definition.metadata.permissions ?? [])],
    handler: { kind: "HostCapability", capability: `system.tool.test.${definition.name}` },
    execution: definition.metadata.execution ?? { Targets: ["Local"], Network: "Deny", Workspace: "ReadOnly" },
    runtime: definition.metadata.runtime ?? {
      Lifecycle: "Immediate",
      ProtocolVersion: 2,
      ResultAssessment: "ProcessExit",
    },
    observationProjection: definition.metadata.observation,
    sources: definition.metadata.sources ?? [],
    search: definition.metadata.search,
    childGrant: "inherit",
    evidenceCapabilities: [...(definition.metadata.evidenceCapabilities ?? [])],
  };
}

function textContent(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((item): item is { type: "text"; text: string } => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}
