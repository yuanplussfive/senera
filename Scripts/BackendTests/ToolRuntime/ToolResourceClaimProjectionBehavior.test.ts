import path from "node:path";
import { describe, expect, test } from "vitest";
import type { SeneraExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraExecutionTypes.js";
import { AgentToolResourceCapabilityRegistry } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResourceCapabilityRegistry.js";
import { AgentToolWorkspacePathResourceCapability } from "../../../Source/AgentSystem/ToolRuntime/AgentToolWorkspacePathResourceCapability.js";
import { AgentToolWorkspaceRootResourceCapability } from "../../../Source/AgentSystem/ToolRuntime/AgentToolWorkspaceRootResourceCapability.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import type { ToolResourceArgumentManifest } from "../../../Source/AgentSystem/Types/AgentToolContractTypes.js";
import { AgentToolResourceClaimProjector } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResourceClaimProjector.js";
import { resourceRequestsConflict } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResourceScheduler.js";

describe("tool resource claim projection", () => {
  test("projects dynamic workspace intents into shared and exclusive claims", async () => {
    const projector = workspaceClaimProjector();
    const tool = resourceTool([
      {
        Capability: "senera.workspace.path",
        Pointer: "/path",
        Parameters: {
          Intent: {
            Selector: "/dryRun",
            Cases: [{ Equals: true, Intent: "read" }],
            Default: "replace",
          },
        },
      },
    ]);

    const reader = await projector.project(tool, { path: "Source/index.ts", dryRun: true });
    const writer = await projector.project(tool, { path: "Source/index.ts", dryRun: false });
    const disjointWriter = await projector.project(tool, { path: "Source/other.ts", dryRun: false });

    expect(reader).toMatchObject({ mode: "claims", claims: [{ access: "shared" }] });
    expect(writer).toMatchObject({ mode: "claims", claims: [{ access: "exclusive" }] });
    expect(resourceRequestsConflict(reader, writer)).toBe(true);
    expect(resourceRequestsConflict(writer, disjointWriter)).toBe(false);
  });

  test("detects parent and child workspace resource overlap", async () => {
    const projector = workspaceClaimProjector();
    const directoryReader = await projector.project(resourceTool([workspaceResource("read")]), {
      path: "Source",
    });
    const childWriter = await projector.project(resourceTool([workspaceResource("replace")]), {
      path: "Source/index.ts",
    });

    expect(resourceRequestsConflict(directoryReader, childWriter)).toBe(true);
  });

  test("claims the whole workspace without a model-facing path argument", async () => {
    const projector = workspaceClaimProjector();
    const root = await projector.project(
      resourceTool([
        {
          Capability: "senera.workspace.root",
          Pointer: "",
          Parameters: { Intent: "replace" },
        },
      ]),
      {},
    );
    const child = await projector.project(resourceTool([workspaceResource("replace")]), {
      path: "Source/index.ts",
    });

    expect(root.claims).toMatchObject([{ identity: path.resolve("E:/workspace"), access: "exclusive" }]);
    expect(resourceRequestsConflict(root, child)).toBe(true);
  });

  test("projects delegated declarations through the registered capability", async () => {
    const projection = await workspaceClaimProjector().projectDeclarations([
      {
        capability: "senera.workspace.path",
        value: "Source/index.ts",
        intent: "replace",
      },
    ]);

    expect(projection).toMatchObject({
      mode: "claims",
      claims: [{ identity: path.resolve("E:/workspace", "Source/index.ts"), access: "exclusive" }],
    });
  });

  test("projects collection path selectors without tool-specific scheduling rules", async () => {
    const projection = await workspaceClaimProjector().project(
      resourceTool([
        {
          Capability: "senera.workspace.path",
          Pointer: "/operations",
          Parameters: {
            Intent: "replace",
            PathPointers: ["/*/path", "/*/source", "/*/destination"],
          },
        },
      ]),
      {
        operations: [
          { kind: "update", path: "Source/a.ts" },
          { kind: "move", source: "Source/b.ts", destination: "Source/c.ts" },
        ],
      },
    );

    expect(projection.claims.map((claim) => claim.identity)).toEqual([
      path.resolve("E:/workspace", "Source/a.ts"),
      path.resolve("E:/workspace", "Source/b.ts"),
      path.resolve("E:/workspace", "Source/c.ts"),
    ]);
    expect(projection.claims.every((claim) => claim.access === "exclusive")).toBe(true);
  });

  test("reports a missing declared resource instead of silently taking a global lease", async () => {
    await expect(workspaceClaimProjector().project(resourceTool([workspaceResource("read")]), {})).rejects.toThrow(
      "Tool resource argument is missing: /path",
    );
  });

  test("rejects ResourceClaims host tools without a resource declaration", async () => {
    await expect(workspaceClaimProjector().project(resourceTool([]), {})).rejects.toThrow(
      "uses ResourceClaims scheduling without declaring resources",
    );
  });

  test("isolates undeclared MCP resources by server and honors read-only annotations", async () => {
    const projector = workspaceClaimProjector();
    const firstReader = await projector.project(mcpTool("weather", true), {});
    const secondReader = await projector.project(mcpTool("weather", true), {});
    const writer = await projector.project(mcpTool("weather", false), {});
    const otherServerWriter = await projector.project(mcpTool("research", false), {});

    expect(resourceRequestsConflict(firstReader, secondReader)).toBe(false);
    expect(resourceRequestsConflict(firstReader, writer)).toBe(true);
    expect(resourceRequestsConflict(writer, otherServerWriter)).toBe(false);
  });
});

function workspaceClaimProjector(): AgentToolResourceClaimProjector {
  const executionEnv: Pick<SeneraExecutionEnv, "resolveResourcePath"> = {
    resolveResourcePath: async (value) => ({
      ok: true,
      value: path.resolve("E:/workspace", value),
    }),
  };
  const capabilities = new AgentToolResourceCapabilityRegistry()
    .register(new AgentToolWorkspacePathResourceCapability(executionEnv))
    .register(
      new AgentToolWorkspaceRootResourceCapability({
        workspaceRoot: "E:/workspace",
        inspectResourcePath: async (value, intent) => ({
          addressedPath: value,
          canonicalPath: path.resolve("E:/workspace", value),
          intent,
          recursive: true,
          facts: {
            scope: "workspace",
            intent,
            authority: "tool",
            domain: "workspace-content",
            domainRoot: true,
            relativePath: ".",
            containment: "inside",
            linkTraversal: "none",
            finalEntry: "directory",
          },
        }),
      }),
    );
  return new AgentToolResourceClaimProjector(capabilities);
}

function workspaceResource(intent: "read" | "replace"): ToolResourceArgumentManifest {
  return {
    Capability: "senera.workspace.path",
    Pointer: "/path",
    Parameters: { Intent: intent },
  };
}

function resourceTool(resources: readonly ToolResourceArgumentManifest[]): RegisteredTool {
  return {
    owner: {
      kind: "mcp",
      name: "test",
      rootPath: process.cwd(),
      revision: "test",
      trusted: false,
      requiresApproval: false,
    },
    name: "test.resource",
    loading: "Dynamic",
    permissions: [],
    handler: {
      kind: "HostCapability",
      capability: "test.resource",
      resources,
    },
    execution: { Targets: ["Local"], Network: "Deny", Workspace: "ReadOnly" },
    runtime: { Lifecycle: "OneShot", ResultAssessment: "ProcessExit" },
    sources: [],
    childGrant: "inherit",
    evidenceCapabilities: [],
  };
}

function mcpTool(serverId: string, readOnly: boolean): RegisteredTool {
  return {
    ...resourceTool([]),
    name: `mcp__${serverId}__test`,
    handler: {
      kind: "McpTool",
      server: {
        id: serverId,
        revision: "test",
        transport: "http",
        url: `https://${serverId}.example/mcp`,
      },
      tool: "test",
      readOnly,
    },
  };
}
