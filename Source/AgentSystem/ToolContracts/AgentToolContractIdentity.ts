import { deepFreeze } from "../Core/AgentDeepFreeze.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { AgentHostCapabilityProtocol } from "../Types/AgentToolContractTypes.js";
import type { RegisteredTool, RegisteredToolContract } from "../Types/AgentToolRuntimeTypes.js";
import { AgentJsonSchemaPromptContractProjector } from "./AgentJsonSchemaPromptContractProjector.js";

const contracts = new AgentJsonSchemaPromptContractProjector();

type InvocationContractSource = Pick<
  RegisteredTool,
  "name" | "description" | "loading" | "planningModes" | "permissions" | "execution" | "approval"
>;

/** Model knowledge is bound to the complete invocation schema, never to package or UI revisions. */
export function createAgentToolContract(
  tool: InvocationContractSource,
  inputSchema: Readonly<Record<string, unknown>>,
  outputSchema: Readonly<Record<string, unknown>> | undefined,
): RegisteredToolContract {
  return deepFreeze({
    digest: sha256HexOfCanonicalJson({
      name: tool.name,
      description: tool.description,
      loading: tool.loading,
      planningModes: tool.planningModes,
      inputSchema,
      outputSchema,
      permissions: tool.permissions,
      execution: tool.execution,
      approval: tool.approval,
    }),
    arguments: contracts.project(inputSchema),
    outputSchema,
  });
}

/** Execution changes refresh host closures and reject stale dispatch without erasing model knowledge. */
export function projectAgentToolExecutionIdentity(tool: RegisteredTool): Record<string, unknown> {
  return {
    name: tool.name,
    owner: {
      kind: tool.owner.kind,
      name: tool.owner.name,
      rootPath: tool.owner.rootPath,
      trusted: tool.owner.trusted,
      requiresApproval: tool.owner.requiresApproval,
    },
    hostCapabilityProtocol: tool.handler.kind === "HostCapability" ? AgentHostCapabilityProtocol : undefined,
    loading: tool.loading,
    planningModes: tool.planningModes,
    contractDigest: tool.contract?.digest,
    handler: tool.handler,
    execution: tool.execution,
    runtime: tool.runtime,
    permissions: tool.permissions,
    childGrant: tool.childGrant,
    approval: tool.approval,
    artifactPolicy: tool.artifactPolicy,
    perception: tool.perception,
    evidenceCapabilities: tool.evidenceCapabilities,
    interactionSurfaces: tool.interactionSurfaces,
    interactionPlatforms: tool.interactionPlatforms,
  };
}

export function createAgentToolExecutionDigest(tool: RegisteredTool): string {
  return sha256HexOfCanonicalJson(projectAgentToolExecutionIdentity(tool));
}
