import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SeneraLocalExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import { SeneraWorkspaceBoundary } from "../../../Source/AgentSystem/Execution/SeneraWorkspaceBoundary.js";
import { createSeneraExecutionEnvironments } from "../../../Source/AgentSystem/Execution/SeneraExecutionEnvFactory.js";
import { AgentPluginRegistry } from "../../../Source/AgentSystem/Plugin/AgentPluginRegistry.js";
import { AgentSeneraOpaPolicyClient } from "../../../Source/AgentSystem/Safety/AgentSeneraOpaPolicyClient.js";
import { AgentResourceAccessIntents } from "../../../Source/AgentSystem/Safety/AgentResourceAccessPolicy.js";
import { AgentResourceAccessPolicy } from "../../../Source/AgentSystem/Safety/AgentResourceAccessPolicy.js";
import { applyWorkspacePatchHostTool } from "../../../Source/AgentSystem/ToolRuntime/AgentWorkspaceApplyPatchRuntime.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Workspace canonical boundary", () => {
  it("resolves safe new targets through their canonical parent", async () => {
    const { workspaceRoot } = createFixture();
    fs.mkdirSync(path.join(workspaceRoot, "notes"));
    const boundary = new SeneraWorkspaceBoundary({ workspaceRoot });

    const target = await boundary.resolve("notes/new.txt", AgentResourceAccessIntents.Replace);

    expect(target.facts).toMatchObject({
      containment: "inside",
      finalEntry: "missing",
      linkTraversal: "none",
      relativePath: "notes/new.txt",
    });
    expect(target.absolutePath).toBe(path.join(fs.realpathSync(workspaceRoot), "notes", "new.txt"));
  });

  it("blocks reads and writes through a directory link that escapes the workspace", async () => {
    const { workspaceRoot, outsideRoot } = createFixture();
    createDirectoryLink(outsideRoot, path.join(workspaceRoot, "escape"));
    fs.writeFileSync(path.join(outsideRoot, "secret.txt"), "outside", "utf8");
    const env = new SeneraLocalExecutionEnv({ workspaceRoot });

    await expect(env.readTextFile("escape/secret.txt")).resolves.toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });
    await expect(env.writeFile("escape/created.txt", "blocked")).resolves.toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });
    expect(fs.existsSync(path.join(outsideRoot, "created.txt"))).toBe(false);
  });

  it("allows reads through an internal directory link but rejects final link mutations", async () => {
    const { workspaceRoot } = createFixture();
    const targetDirectory = path.join(workspaceRoot, "target");
    fs.mkdirSync(targetDirectory);
    fs.writeFileSync(path.join(targetDirectory, "value.txt"), "inside", "utf8");
    createDirectoryLink(targetDirectory, path.join(workspaceRoot, "internal"));
    const env = new SeneraLocalExecutionEnv({ workspaceRoot });

    await expect(env.readTextFile("internal/value.txt")).resolves.toEqual({ ok: true, value: "inside" });
    await expect(env.remove("internal", { recursive: true })).resolves.toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });
    expect(fs.readFileSync(path.join(targetDirectory, "value.txt"), "utf8")).toBe("inside");
  });

  it("supports boundaries that reject internal links for protected system data", async () => {
    const { workspaceRoot } = createFixture();
    const targetDirectory = path.join(workspaceRoot, "target");
    fs.mkdirSync(targetDirectory);
    fs.writeFileSync(path.join(targetDirectory, "value.txt"), "inside", "utf8");
    createDirectoryLink(targetDirectory, path.join(workspaceRoot, "internal"));
    const boundary = new SeneraWorkspaceBoundary({ workspaceRoot, linkPolicy: "deny" });

    await expect(boundary.resolve("internal/value.txt", AgentResourceAccessIntents.Read)).rejects.toMatchObject({
      code: "link_not_allowed",
    });
  });

  it("rejects a file replaced after it has been opened", async () => {
    const { workspaceRoot } = createFixture();
    const filePath = path.join(workspaceRoot, "value.txt");
    fs.writeFileSync(filePath, "original", "utf8");
    const boundary = new SeneraWorkspaceBoundary({ workspaceRoot, linkPolicy: "deny" });
    const resolve = boundary.resolve.bind(boundary);
    let resolutions = 0;
    vi.spyOn(boundary, "resolve").mockImplementation(async (...args) => {
      resolutions += 1;
      if (resolutions === 2) {
        fs.renameSync(filePath, path.join(workspaceRoot, "original.txt"));
        fs.writeFileSync(filePath, "replacement", "utf8");
      }
      return resolve(...args);
    });

    await expect(boundary.openFile(filePath, AgentResourceAccessIntents.Read)).rejects.toMatchObject({
      code: "path_changed",
    });
  });

  it("prevents WorkspaceApplyPatch from creating files through an escaping link", async () => {
    const { workspaceRoot, outsideRoot } = createFixture();
    createDirectoryLink(outsideRoot, path.join(workspaceRoot, "escape"));
    const executionEnv = new SeneraLocalExecutionEnv({ workspaceRoot });

    const result = await applyWorkspacePatchHostTool(
      { operations: [{ kind: "add", path: "escape/patch.txt", content: "blocked" }] },
      {
        workspaceRoot,
        executionEnv,
        tool: {
          name: "WorkspaceApplyPatch",
          runtime: { Lifecycle: "Immediate", ProtocolVersion: 2, Capabilities: { Progress: true } },
        },
        config: {},
        registry: { getTool: () => undefined },
      } as never,
    );

    expect(result.response.ok).toBe(false);
    expect(fs.existsSync(path.join(outsideRoot, "patch.txt"))).toBe(false);
  });

  it("separates trusted system state from OPA-governed tool mutations", async () => {
    const { workspaceRoot } = createFixture();
    const policy = new AgentResourceAccessPolicy(
      new AgentSeneraOpaPolicyClient({ registry: new AgentPluginRegistry() }),
    );
    const environments = createSeneraExecutionEnvironments({ workspaceRoot, resourceAccessPolicy: policy });

    await expect(environments.system.writeFile(".senera/pi-sessions/state.json", "system")).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(environments.tool.writeFile(".senera/tool-state.json", "tool")).resolves.toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });
    expect(fs.readFileSync(path.join(workspaceRoot, ".senera", "pi-sessions", "state.json"), "utf8")).toBe("system");
    expect(fs.existsSync(path.join(workspaceRoot, ".senera", "tool-state.json"))).toBe(false);
  });
});

function createFixture(): { workspaceRoot: string; outsideRoot: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-workspace-boundary-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const outsideRoot = path.join(root, "outside");
  fs.mkdirSync(workspaceRoot);
  fs.mkdirSync(outsideRoot);
  return { workspaceRoot, outsideRoot };
}

function createDirectoryLink(target: string, linkPath: string): void {
  fs.symlinkSync(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}
