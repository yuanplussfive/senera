import { createAgentToolContract } from "../ToolContracts/AgentToolContractIdentity.js";
import {
  AgentToolChildGrantModes,
  ToolLoadingModes,
  ToolResultAssessmentPolicies,
} from "../Types/AgentToolContractTypes.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import type { AgentMcpToolDeclaration } from "../Mcp/AgentMcpToolCatalogChange.js";
import { agentMcpPackageToolName } from "./AgentMcpPackageIdentity.js";
import {
  AgentMcpPackageSourceKinds,
  type AgentMcpPackage,
  type AgentMcpPackageServer,
  type AgentMcpDeclaredEndpoint,
} from "./AgentMcpPackageTypes.js";
import type { AgentMcpPackageExecutionPolicy } from "./AgentMcpPackageExecutionPolicy.js";
import type { AgentExtensionOwner } from "../Types/AgentExtensionRuntimeTypes.js";
import type { ToolSearchCapabilityManifest } from "../Types/AgentToolSearchContractTypes.js";
import { projectAgentMcpToolRuntime } from "../Mcp/AgentMcpToolRuntimeMetadata.js";
import { resolveMcpToolLocalization, validateMcpToolLocalization } from "./AgentMcpToolLocalization.js";

export function projectAgentMcpPackageTools(
  package_: AgentMcpPackage,
  server: AgentMcpPackageServer,
  declarations: readonly AgentMcpToolDeclaration[],
  execution: AgentMcpPackageExecutionPolicy,
  endpoint: AgentMcpDeclaredEndpoint,
): RegisteredTool[] {
  const owner = createAgentMcpPackageOwner(package_, server);
  validateMcpToolLocalization(
    server.toolLocalization,
    declarations.map((declaration) => declaration.name),
  );
  return declarations.map((declaration) => projectMcpTool(owner, server, declaration, execution, endpoint));
}

function projectMcpTool(
  owner: AgentExtensionOwner,
  server: AgentMcpPackageServer,
  declaration: AgentMcpToolDeclaration,
  execution: AgentMcpPackageExecutionPolicy,
  endpoint: AgentMcpDeclaredEndpoint,
): RegisteredTool {
  const title = declaration.annotations?.title?.trim() || declaration.name;
  const description = requireMcpToolDescription(server, declaration);
  const semanticDescription = description;
  const readOnly = declaration.annotations?.readOnlyHint === true;
  const runtimePolicy = projectAgentMcpToolRuntime(declaration);

  const tool: RegisteredTool = {
    availability: endpoint.transport === "unresolved" ? endpoint.availability : { status: "ready" },
    owner,
    name: agentMcpPackageToolName(server.name, declaration.name),
    description,
    loading: ToolLoadingModes.Dynamic,
    permissions: [],
    handler: {
      kind: "McpTool" as const,
      server: endpoint,
      tool: declaration.name,
      readOnly,
    },
    execution: {
      Targets: [...execution.targets],
      Network: "Allow" as const,
      Workspace: "ReadOnly" as const,
    },
    runtime: {
      Lifecycle: "Persistent" as const,
      ResultAssessment: ToolResultAssessmentPolicies.ProcessExit,
      ...(runtimePolicy.deadlinePolicy === undefined ? {} : { DeadlinePolicy: runtimePolicy.deadlinePolicy }),
      ...(runtimePolicy.deadlineMs === undefined ? {} : { DeadlineMs: runtimePolicy.deadlineMs }),
      Scheduling: runtimePolicy.scheduling,
      ...(runtimePolicy.maxConcurrency === undefined ? {} : { MaxConcurrency: runtimePolicy.maxConcurrency }),
      Capabilities: { Cancellation: true },
    },
    sources: [
      {
        Id: `mcp:${server.name}`,
        Title: server.name,
        Description: owner.description ?? server.name,
      },
    ],
    search: {
      Summary: semanticDescription,
      Capabilities: [projectMcpCapability(server, declaration, title, description, readOnly)],
      UseCases: [semanticDescription],
    },
    childGrant: AgentToolChildGrantModes.Inherit,
    evidenceCapabilities: [],
    approval: declaration.annotations?.destructiveHint
      ? { Mode: "ask" as const, Reason: "MCP tool declares a destructive side effect." }
      : undefined,
  };
  return { ...tool, contract: createAgentToolContract(tool, declaration.inputSchema, declaration.outputSchema) };
}

function projectMcpCapability(
  server: AgentMcpPackageServer,
  declaration: AgentMcpToolDeclaration,
  title: string,
  description: string,
  readOnly: boolean,
): ToolSearchCapabilityManifest {
  const properties = declaration.inputSchema.properties;
  const inputs = isRecord(properties) ? Object.keys(properties).sort() : [];
  // MCP tool names and descriptions originate with the package/server. Any
  // localized retrieval vocabulary must therefore travel with that package
  // through its declared manifest metadata, rather than a host-maintained
  // table that drifts as third-party servers change.
  const aliases = resolveMcpToolLocalization(server.toolLocalization, declaration.name);
  return {
    Id: `mcp.${server.name}.${declaration.name}`,
    Title: title,
    Description: description,
    ...(aliases.length > 0 ? { Aliases: [...aliases] } : {}),
    ...(inputs.length > 0 || readOnly
      ? {
          Facets: {
            ...(inputs.length > 0 ? { Inputs: inputs } : {}),
            ...(readOnly ? { Effects: ["read-only"] } : {}),
          },
        }
      : {}),
    ...(declaration.annotations?.destructiveHint
      ? { Risk: { SideEffect: "declared-destructive" } }
      : declaration.annotations?.readOnlyHint
        ? { Risk: { SideEffect: "read-only" } }
        : {}),
  };
}

function requireMcpToolDescription(server: AgentMcpPackageServer, declaration: AgentMcpToolDeclaration): string {
  const description = declaration.description?.trim();
  if (description) return description;
  throw new Error(
    `MCP tool ${server.name}/${declaration.name} must declare a non-empty description for ToolSearch discovery.`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createAgentMcpPackageOwner(
  package_: AgentMcpPackage,
  server: AgentMcpPackageServer,
): AgentExtensionOwner {
  const bundled = package_.source === AgentMcpPackageSourceKinds.Bundled;
  return {
    kind: "mcp" as const,
    name: server.name,
    title: server.name,
    description: `${bundled ? "Bundled" : "Workspace"} MCP server from package ${package_.name}.`,
    rootPath: package_.rootPath,
    revision: package_.revision,
    trusted: bundled,
    requiresApproval: !bundled,
  };
}
