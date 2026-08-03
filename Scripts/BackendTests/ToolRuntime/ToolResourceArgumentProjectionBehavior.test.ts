import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SeneraLocalExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import { createSeneraExecutionEnvironments } from "../../../Source/AgentSystem/Execution/SeneraExecutionEnvFactory.js";
import type { SeneraExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraExecutionTypes.js";
import { projectAgentToolResourceArguments } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResourceArgumentProjector.js";
import { AgentToolResourceCapabilityRegistry } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResourceCapabilityRegistry.js";
import { AgentToolUploadReadResourceCapability } from "../../../Source/AgentSystem/ToolRuntime/AgentToolUploadReadResourceCapability.js";
import { AgentToolWorkspacePathResourceCapability } from "../../../Source/AgentSystem/ToolRuntime/AgentToolWorkspacePathResourceCapability.js";
import { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { AgentResourceAccessPolicy } from "../../../Source/AgentSystem/Safety/AgentResourceAccessPolicy.js";
import { AgentSeneraOpaPolicyClient } from "../../../Source/AgentSystem/Safety/AgentSeneraOpaPolicyClient.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("tool resource argument projection", () => {
  it("projects a workspace path to its canonical physical path", async () => {
    const { workspaceRoot } = createFixture();
    const source = path.join(workspaceRoot, "Source");
    fs.mkdirSync(source);
    const executionEnv = new SeneraLocalExecutionEnv({ workspaceRoot });

    const normalized = await projectAgentToolResourceArguments(
      { path: "Source", pattern: "needle" },
      [workspaceResource("/path", "read")],
      workspaceCapabilities(executionEnv),
    );
    expect(normalized).toEqual({ path: fs.realpathSync(source), pattern: "needle" });
  });

  it("rejects lexical and linked workspace escapes", async () => {
    const { workspaceRoot, outsideRoot } = createFixture();
    createDirectoryLink(outsideRoot, path.join(workspaceRoot, "escape"));
    const executionEnv = new SeneraLocalExecutionEnv({ workspaceRoot });

    await expect(
      projectAgentToolResourceArguments(
        { path: "../outside" },
        [workspaceResource("/path", "read")],
        workspaceCapabilities(executionEnv),
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await expect(
      projectAgentToolResourceArguments(
        { path: "escape" },
        [workspaceResource("/path", "read")],
        workspaceCapabilities(executionEnv),
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("applies intent-aware OPA policy to filesystem resource fields", async () => {
    const { workspaceRoot } = createFixture();
    fs.mkdirSync(path.join(workspaceRoot, ".git"));
    fs.writeFileSync(path.join(workspaceRoot, ".git", "config"), "safe read", "utf8");
    const policy = new AgentResourceAccessPolicy(
      new AgentSeneraOpaPolicyClient({ registry: new AgentExtensionRegistry() }),
    );
    const executionEnv = createSeneraExecutionEnvironments({ workspaceRoot, resourceAccessPolicy: policy }).tool;

    await expect(
      projectAgentToolResourceArguments(
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
      projectAgentToolResourceArguments(
        { path: ".git/config", content: "blocked" },
        [workspaceResource("/path", "replace")],
        workspaceCapabilities(executionEnv),
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await expect(
      projectAgentToolResourceArguments(
        { source: ".git/config", destination: "config-copy" },
        [workspaceResource("/source", "remove"), workspaceResource("/destination", "create")],
        workspaceCapabilities(executionEnv),
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("projects nested resource pointers immutably for arbitrary tools", async () => {
    const { workspaceRoot } = createFixture();
    const source = path.join(workspaceRoot, "Source");
    fs.mkdirSync(source);
    const executionEnv = new SeneraLocalExecutionEnv({ workspaceRoot });
    const args = { request: { targets: [{ location: "Source" }] }, mode: "inspect" };

    const normalized = await projectAgentToolResourceArguments(
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
      projectAgentToolResourceArguments(
        { request: { path: 42 } },
        [workspaceResource("/request/path", "read")],
        workspaceCapabilities(executionEnv),
      ),
    ).rejects.toThrow("Workspace resource /request/path must be a string.");
  });

  it("projects a host-authorized upload through its registered capability", async () => {
    const registry = new AgentToolResourceCapabilityRegistry().register(
      new AgentToolUploadReadResourceCapability({
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

    const projected = await projectAgentToolResourceArguments(
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
): AgentToolResourceCapabilityRegistry {
  return new AgentToolResourceCapabilityRegistry().register(new AgentToolWorkspacePathResourceCapability(executionEnv));
}

function workspaceResource(pointer: string, intent: unknown) {
  return {
    Capability: "senera.workspace.path",
    Pointer: pointer,
    Parameters: { Intent: intent },
  };
}
