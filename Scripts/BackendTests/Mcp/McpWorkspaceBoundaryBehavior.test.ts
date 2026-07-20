import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SeneraLocalExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import { createSeneraExecutionEnvironments } from "../../../Source/AgentSystem/Execution/SeneraExecutionEnvFactory.js";
import { projectAgentMcpResourceArguments } from "../../../Source/AgentSystem/Mcp/AgentMcpResourceArgumentProjector.js";
import { resolveAgentRipgrepWorkspaceTarget } from "../../../Source/AgentSystem/Mcp/AgentRipgrepWorkspace.js";
import { AgentPluginRegistry } from "../../../Source/AgentSystem/Plugin/AgentPluginRegistry.js";
import { AgentResourceAccessPolicy } from "../../../Source/AgentSystem/Safety/AgentResourceAccessPolicy.js";
import { AgentSeneraOpaPolicyClient } from "../../../Source/AgentSystem/Safety/AgentSeneraOpaPolicyClient.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("MCP workspace boundary", () => {
  it("projects a validated ripgrep path relative to its canonical workspace cwd", async () => {
    const { workspaceRoot } = createFixture();
    const source = path.join(workspaceRoot, "Source");
    fs.mkdirSync(source);
    const executionEnv = new SeneraLocalExecutionEnv({ workspaceRoot });

    const normalized = await projectAgentMcpResourceArguments(
      { path: "Source", pattern: "needle" },
      [{ Pointer: "/path", Intent: "read" }],
      executionEnv,
    );
    const target = await resolveAgentRipgrepWorkspaceTarget(workspaceRoot, String(normalized.path));

    expect(target).toEqual({ cwd: fs.realpathSync(workspaceRoot), searchPath: "Source" });
  });

  it("rejects lexical and linked ripgrep escapes", async () => {
    const { workspaceRoot, outsideRoot } = createFixture();
    createDirectoryLink(outsideRoot, path.join(workspaceRoot, "escape"));
    const executionEnv = new SeneraLocalExecutionEnv({ workspaceRoot });

    await expect(
      projectAgentMcpResourceArguments({ path: "../outside" }, [{ Pointer: "/path", Intent: "read" }], executionEnv),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await expect(
      projectAgentMcpResourceArguments({ path: "escape" }, [{ Pointer: "/path", Intent: "read" }], executionEnv),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await expect(resolveAgentRipgrepWorkspaceTarget(workspaceRoot, "escape")).rejects.toMatchObject({
      code: "outside_workspace",
    });
  });

  it("applies intent-aware OPA policy to filesystem MCP resource fields", async () => {
    const { workspaceRoot } = createFixture();
    fs.mkdirSync(path.join(workspaceRoot, ".git"));
    fs.writeFileSync(path.join(workspaceRoot, ".git", "config"), "safe read", "utf8");
    const policy = new AgentResourceAccessPolicy(
      new AgentSeneraOpaPolicyClient({ registry: new AgentPluginRegistry() }),
    );
    const executionEnv = createSeneraExecutionEnvironments({ workspaceRoot, resourceAccessPolicy: policy }).tool;

    await expect(
      projectAgentMcpResourceArguments(
        { path: ".git/config", edits: [], dryRun: true },
        [
          {
            Pointer: "/path",
            Intent: {
              Selector: "/dryRun",
              Cases: [{ Equals: true, Intent: "read" }],
              Default: "replace",
            },
          },
        ],
        executionEnv,
      ),
    ).resolves.toMatchObject({ path: fs.realpathSync(path.join(workspaceRoot, ".git", "config")) });
    await expect(
      projectAgentMcpResourceArguments(
        { path: ".git/config", content: "blocked" },
        [{ Pointer: "/path", Intent: "replace" }],
        executionEnv,
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await expect(
      projectAgentMcpResourceArguments(
        { source: ".git/config", destination: "config-copy" },
        [
          { Pointer: "/source", Intent: "remove" },
          { Pointer: "/destination", Intent: "create" },
        ],
        executionEnv,
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("projects nested resource pointers immutably for arbitrary MCP tools", async () => {
    const { workspaceRoot } = createFixture();
    const source = path.join(workspaceRoot, "Source");
    fs.mkdirSync(source);
    const executionEnv = new SeneraLocalExecutionEnv({ workspaceRoot });
    const args = { request: { targets: [{ location: "Source" }] }, mode: "inspect" };

    const normalized = await projectAgentMcpResourceArguments(
      args,
      [{ Pointer: "/request/targets/0/location", Intent: "read" }],
      executionEnv,
    );

    expect(normalized).toEqual({
      request: { targets: [{ location: fs.realpathSync(source) }] },
      mode: "inspect",
    });
    expect(args.request.targets[0]?.location).toBe("Source");
  });

  it("rejects non-string values at declared resource pointers", async () => {
    const { workspaceRoot } = createFixture();
    const executionEnv = new SeneraLocalExecutionEnv({ workspaceRoot });

    await expect(
      projectAgentMcpResourceArguments(
        { request: { path: 42 } },
        [{ Pointer: "/request/path", Intent: "read" }],
        executionEnv,
      ),
    ).rejects.toThrow("MCP resource argument /request/path must be a string.");
  });
});

function createFixture(): { workspaceRoot: string; outsideRoot: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-mcp-boundary-"));
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
