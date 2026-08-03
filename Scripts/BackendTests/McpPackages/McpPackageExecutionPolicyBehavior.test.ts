import { describe, expect, test } from "vitest";
import { ToolExecutionTargets } from "../../../Source/AgentSystem/Types/AgentToolContractTypes.js";
import { AgentMcpExecutionTargets } from "../../../Source/AgentSystem/McpPackages/AgentMcpPackageSchema.js";
import { resolveAgentMcpPackageExecutionPolicy } from "../../../Source/AgentSystem/McpPackages/AgentMcpPackageExecutionPolicy.js";
import { projectAgentMcpPackageTools } from "../../../Source/AgentSystem/McpPackages/AgentMcpPackageToolProjector.js";
import { createAgentMcpPackageEndpoint } from "../../../Source/AgentSystem/McpPackages/AgentMcpPackageRuntime.js";
import {
  AgentMcpPackageSourceKinds,
  type AgentMcpPackage,
  type AgentMcpPackageServer,
} from "../../../Source/AgentSystem/McpPackages/AgentMcpPackageTypes.js";

const stdioServer: AgentMcpPackageServer = {
  name: "test-server",
  inputs: [],
  configuration: { type: "stdio", command: literal("node"), args: [], cwd: literal(".") },
};

describe("MCP package execution policy", () => {
  test("preserves the package preference when the host supports all requested targets", () => {
    const policy = resolveAgentMcpPackageExecutionPolicy(
      packageWith({
        targets: [AgentMcpExecutionTargets.Sandbox, AgentMcpExecutionTargets.Local],
        preferred: AgentMcpExecutionTargets.Sandbox,
      }),
      stdioServer,
      hostWith(["sandbox", "local"]),
    );

    expect(policy).toEqual({
      targets: [ToolExecutionTargets.Sandbox, ToolExecutionTargets.Local],
      preferred: ToolExecutionTargets.Sandbox,
      preferredBackend: "sandbox",
    });
  });

  test("removes unavailable targets while retaining a runnable preference", () => {
    const policy = resolveAgentMcpPackageExecutionPolicy(
      packageWith({
        targets: [AgentMcpExecutionTargets.Sandbox, AgentMcpExecutionTargets.Local],
        preferred: AgentMcpExecutionTargets.Sandbox,
      }),
      stdioServer,
      hostWith(["local"]),
    );

    expect(policy).toEqual({
      targets: [ToolExecutionTargets.Local],
      preferred: ToolExecutionTargets.Local,
      preferredBackend: "local",
    });
  });

  test("rejects a package whose requested targets cannot run on the host", () => {
    expect(() =>
      resolveAgentMcpPackageExecutionPolicy(
        packageWith({ targets: [AgentMcpExecutionTargets.Sandbox], preferred: AgentMcpExecutionTargets.Sandbox }),
        stdioServer,
        hostWith(["local"]),
      ),
    ).toThrow("requests sandbox, but this host supports local");
  });

  test("does not require a persistent-process backend for remote HTTP servers", () => {
    const policy = resolveAgentMcpPackageExecutionPolicy(
      packageWith(undefined),
      {
        name: "remote",
        inputs: [],
        configuration: { type: "http", url: literal("https://example.test/mcp") },
      },
      hostWith([]),
    );

    expect(policy).toEqual({
      targets: [ToolExecutionTargets.Local],
      preferred: ToolExecutionTargets.Local,
      preferredBackend: "local",
    });
  });

  test("projects bundled and workspace MCP packages with distinct trust policies", () => {
    const execution = {
      targets: [ToolExecutionTargets.Local],
      preferred: ToolExecutionTargets.Local,
      preferredBackend: "local" as const,
    };
    const declaration = {
      name: "inspect",
      description: "Inspect a value.",
      inputSchema: { type: "object", properties: {} },
    };
    const workspacePackage = packageWith({ targets: ["local"], preferred: "local" });
    const workspaceTool = projectAgentMcpPackageTools(
      workspacePackage,
      stdioServer,
      [declaration],
      execution,
      createAgentMcpPackageEndpoint(workspacePackage, stdioServer),
    ).at(0);
    const bundledPackage = { ...workspacePackage, source: AgentMcpPackageSourceKinds.Bundled };
    const bundledTool = projectAgentMcpPackageTools(
      bundledPackage,
      stdioServer,
      [declaration],
      execution,
      createAgentMcpPackageEndpoint(bundledPackage, stdioServer),
    ).at(0);

    expect(workspaceTool?.owner).toMatchObject({ trusted: false, requiresApproval: true });
    expect(bundledTool?.owner).toMatchObject({ trusted: true, requiresApproval: false });
  });
});

function packageWith(execution: AgentMcpPackage["execution"]): AgentMcpPackage {
  return {
    name: "test-package",
    rootPath: "/package",
    configurationPath: "/package/.mcp.json",
    revision: "test",
    source: AgentMcpPackageSourceKinds.Workspace,
    descriptorKind: "legacy",
    execution,
    servers: [],
  };
}

function literal(value: string) {
  return { segments: [{ kind: "literal" as const, value }] };
}

function hostWith(persistentProcessBackends: readonly ("sandbox" | "local")[]) {
  return { capabilities: { persistentProcessBackends } };
}
