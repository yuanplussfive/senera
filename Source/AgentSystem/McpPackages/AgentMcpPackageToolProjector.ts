import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { AgentJsonSchemaPromptContractProjector } from "../ToolContracts/AgentJsonSchemaPromptContractProjector.js";
import { ToolLoadingModes, ToolResultAssessmentPolicies } from "../Types/AgentToolContractTypes.js";
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

const contractProjector = new AgentJsonSchemaPromptContractProjector();

export function projectAgentMcpPackageTools(
  package_: AgentMcpPackage,
  server: AgentMcpPackageServer,
  declarations: readonly AgentMcpToolDeclaration[],
  execution: AgentMcpPackageExecutionPolicy,
  endpoint: AgentMcpRuntimeEndpoint,
): RegisteredTool[] {
  const owner = createAgentMcpPackageOwner(package_, server);
  return declarations.map((declaration) => ({
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
      readOnly: declaration.annotations?.readOnlyHint === true,
    },
    execution: {
      Targets: [...execution.targets],
      Network: "Allow" as const,
      Workspace: "ReadOnly" as const,
    },
    runtime: {
      Lifecycle: "Persistent" as const,
      ResultAssessment: ToolResultAssessmentPolicies.ProcessExit,
      Capabilities: { Cancellation: true },
    },
    observationProjection: StandardAgentToolObservationProjection,
    sources: [],
    search: { Summary: declaration.description ?? declaration.name },
    evidenceCapabilities: [],
    approval: declaration.annotations?.destructiveHint
      ? { Mode: "ask" as const, Reason: "MCP tool declares a destructive side effect." }
      : undefined,
  }));
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
