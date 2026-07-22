import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SeneraLocalExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import { createSeneraExecutionEnvironments } from "../../../Source/AgentSystem/Execution/SeneraExecutionEnvFactory.js";
import type { SeneraExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraExecutionTypes.js";
import { projectAgentMcpResourceArguments } from "../../../Source/AgentSystem/Mcp/AgentMcpResourceArgumentProjector.js";
import { AgentMcpResourceCapabilityRegistry } from "../../../Source/AgentSystem/Mcp/AgentMcpResourceCapabilityRegistry.js";
import { AgentMcpUploadReadResourceCapability } from "../../../Source/AgentSystem/Mcp/AgentMcpUploadReadResourceCapability.js";
import { AgentMcpWorkspacePathResourceCapability } from "../../../Source/AgentSystem/Mcp/AgentMcpWorkspacePathResourceCapability.js";
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
      [workspaceResource("/path", "read")],
      workspaceCapabilities(executionEnv),
    );
    const target = await resolveAgentRipgrepWorkspaceTarget(workspaceRoot, String(normalized.path));

    expect(target).toEqual({ cwd: fs.realpathSync(workspaceRoot), searchPath: "Source" });
  });

  it("rejects lexical and linked ripgrep escapes", async () => {
    const { workspaceRoot, outsideRoot } = createFixture();
    createDirectoryLink(outsideRoot, path.join(workspaceRoot, "escape"));
    const executionEnv = new SeneraLocalExecutionEnv({ workspaceRoot });

    await expect(
      projectAgentMcpResourceArguments(
        { path: "../outside" },
        [workspaceResource("/path", "read")],
        workspaceCapabilities(executionEnv),
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await expect(
      projectAgentMcpResourceArguments(
        { path: "escape" },
        [workspaceResource("/path", "read")],
        workspaceCapabilities(executionEnv),
      ),
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
          workspaceResource("/path", {
            Selector: "/dryRun",
            Cases: [{ Equals: true, Intent: "read" }],
            Default: "replace",
          }),
        ],
        workspaceCapabilities(executionEnv),
      ),
    ).resolves.toMatchObject({ path: fs.realpathSync(path.join(workspaceRoot, ".git", "config")) });
    await expect(
      projectAgentMcpResourceArguments(
        { path: ".git/config", content: "blocked" },
        [workspaceResource("/path", "replace")],
        workspaceCapabilities(executionEnv),
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await expect(
      projectAgentMcpResourceArguments(
        { source: ".git/config", destination: "config-copy" },
        [workspaceResource("/source", "remove"), workspaceResource("/destination", "create")],
        workspaceCapabilities(executionEnv),
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
      [workspaceResource("/request/targets/0/location", "read")],
      workspaceCapabilities(executionEnv),
    );

    expect(normalized).toEqual({ request: { targets: [{ location: fs.realpathSync(source) }] }, mode: "inspect" });
    expect(args.request.targets[0]?.location).toBe("Source");
  });

  it("rejects non-string values at declared resource pointers", async () => {
    const { workspaceRoot } = createFixture();
    const executionEnv = new SeneraLocalExecutionEnv({ workspaceRoot });

    await expect(
      projectAgentMcpResourceArguments(
        { request: { path: 42 } },
        [workspaceResource("/request/path", "read")],
        workspaceCapabilities(executionEnv),
      ),
    ).rejects.toThrow("MCP workspace resource /request/path must be a string.");
  });

  it("projects a host-authorized upload through its registered capability", async () => {
    const registry = new AgentMcpResourceCapabilityRegistry().register(
      new AgentMcpUploadReadResourceCapability({
        resolve: async (uploadUri) =>
          uploadUri === "senera://upload/upl_test"
            ? {
                filePath: "C:/isolated/uploads/upl_test/original",
                uploadDir: "C:/isolated/uploads/upl_test",
                manifest: {
                  uploadId: "upl_test",
                  uploadUri,
                  name: "diagram.png",
                  mime: "image/png",
                  size: 42,
                  sha256: "a".repeat(64),
                  createdAt: "2026-01-01T00:00:00.000Z",
                  storage: { fileName: "original" },
                },
              }
            : undefined,
      }),
    );
    const args = {
      uploadUri: "senera://upload/upl_test",
      task: "inspect",
      resources: { image: { filePath: "untrusted-model-value" } },
    };

    const projected = await projectAgentMcpResourceArguments(
      args,
      [
        {
          Capability: "senera.upload.read",
          Pointer: "/uploadUri",
          Binding: "image",
        },
      ],
      registry,
    );

    expect(args).toEqual({
      uploadUri: "senera://upload/upl_test",
      task: "inspect",
      resources: { image: { filePath: "untrusted-model-value" } },
    });
    expect(projected).toEqual({
      uploadUri: "senera://upload/upl_test",
      task: "inspect",
      resources: {
        image: {
          uploadUri: "senera://upload/upl_test",
          filePath: "C:/isolated/uploads/upl_test/original",
          name: "diagram.png",
          mime: "image/png",
          size: 42,
          sha256: "a".repeat(64),
        },
      },
    });
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

function workspaceCapabilities(
  executionEnv: Pick<SeneraExecutionEnv, "resolveResourcePath">,
): AgentMcpResourceCapabilityRegistry {
  return new AgentMcpResourceCapabilityRegistry().register(new AgentMcpWorkspacePathResourceCapability(executionEnv));
}

function workspaceResource(pointer: string, intent: unknown) {
  return {
    Capability: "senera.workspace.path",
    Pointer: pointer,
    Parameters: { Intent: intent },
  };
}
