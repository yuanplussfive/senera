import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { AgentJsonSchemaPromptContractProjector } from "../ToolContracts/AgentJsonSchemaPromptContractProjector.js";
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
  type AgentMcpRuntimeEndpoint,
} from "./AgentMcpPackageTypes.js";
import type { AgentMcpPackageExecutionPolicy } from "./AgentMcpPackageExecutionPolicy.js";
import type { AgentExtensionOwner } from "../Types/AgentExtensionRuntimeTypes.js";
import { StandardAgentToolObservationProjection } from "../ToolRuntime/AgentToolObservationProjectionPlan.js";
import type { ToolSearchCapabilityManifest } from "../Types/AgentToolSearchContractTypes.js";
import { projectAgentMcpToolRuntime } from "../Mcp/AgentMcpToolRuntimeMetadata.js";

const contractProjector = new AgentJsonSchemaPromptContractProjector();

export function projectAgentMcpPackageTools(
  package_: AgentMcpPackage,
  server: AgentMcpPackageServer,
  declarations: readonly AgentMcpToolDeclaration[],
  execution: AgentMcpPackageExecutionPolicy,
  endpoint: AgentMcpRuntimeEndpoint,
): RegisteredTool[] {
  const owner = createAgentMcpPackageOwner(package_, server);
  return declarations.map((declaration) => projectMcpTool(owner, package_, server, declaration, execution, endpoint));
}

function projectMcpTool(
  owner: AgentExtensionOwner,
  package_: AgentMcpPackage,
  server: AgentMcpPackageServer,
  declaration: AgentMcpToolDeclaration,
  execution: AgentMcpPackageExecutionPolicy,
  endpoint: AgentMcpRuntimeEndpoint,
): RegisteredTool {
  const title = declaration.annotations?.title?.trim() || declaration.name;
  const description = declaration.description?.trim();
  const semanticDescription = description || title;
  const readOnly = declaration.annotations?.readOnlyHint === true;
  const runtimePolicy = projectAgentMcpToolRuntime(declaration);

  return {
    owner,
    name: agentMcpPackageToolName(server.name, declaration.name),
    loading: ToolLoadingModes.Dynamic,
    contract: {
      digest: sha256HexOfCanonicalJson({
        package: package_.name,
        revision: package_.revision,
        server: server.name,
        tool: declaration.name,
        inputSchema: declaration.inputSchema,
        outputSchema: declaration.outputSchema,
      }),
      arguments: contractProjector.project(declaration.inputSchema),
      outputSchema: declaration.outputSchema,
    },
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
      Scheduling: runtimePolicy.scheduling,
      ...(runtimePolicy.maxConcurrency === undefined ? {} : { MaxConcurrency: runtimePolicy.maxConcurrency }),
      Capabilities: { Cancellation: true },
    },
    observationProjection: StandardAgentToolObservationProjection,
    sources: [
      {
        Id: `mcp:${server.name}`,
        Title: server.name,
        Description: owner.description ?? server.name,
      },
    ],
    search: {
      Summary: semanticDescription,
      Capabilities: [projectMcpCapability(server.name, declaration, title, description, readOnly)],
      UseCases: [semanticDescription],
    },
    childGrant: AgentToolChildGrantModes.Inherit,
    evidenceCapabilities: [],
    approval: declaration.annotations?.destructiveHint
      ? { Mode: "ask" as const, Reason: "MCP tool declares a destructive side effect." }
      : undefined,
  };
}

function projectMcpCapability(
  serverName: string,
  declaration: AgentMcpToolDeclaration,
  title: string,
  description: string | undefined,
  readOnly: boolean,
): ToolSearchCapabilityManifest {
  const properties = declaration.inputSchema.properties;
  const inputs = isRecord(properties) ? Object.keys(properties).sort() : [];
  return {
    Id: `mcp.${serverName}.${declaration.name}`,
    Title: title,
    ...(description ? { Description: description } : {}),
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
