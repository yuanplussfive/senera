import type { AgentPluginRegistry } from "../Plugin/AgentPluginRegistry.js";
import { createAgentAiSdkGuardrailAuditor } from "./AgentAiSdkGuardrailAuditor.js";
import { AgentCompositeToolApprovalPolicy } from "./AgentToolApprovalPolicy.js";
import type { AgentToolGuardrailAuditor } from "./AgentToolGuardrailAudit.js";
import { AgentSeneraOpaPolicyClient } from "./AgentSeneraOpaPolicyClient.js";

import { AgentToolApprovalPolicyArtifactContract } from "./AgentToolApprovalPolicyArtifact.js";

const DefaultToolApprovalPolicyPath = AgentToolApprovalPolicyArtifactContract.entrypoints.toolDecision;

export interface AgentToolApprovalPolicyFactoryOptions {
  readonly registry: AgentPluginRegistry;
  readonly auditors?: readonly AgentToolGuardrailAuditor[];
  readonly path?: string;
}

export function createAgentToolApprovalPolicy(
  options: AgentToolApprovalPolicyFactoryOptions,
): AgentCompositeToolApprovalPolicy {
  return new AgentCompositeToolApprovalPolicy({
    auditors: [createAgentAiSdkGuardrailAuditor(), ...(options.auditors ?? [])],
    opa: {
      client: new AgentSeneraOpaPolicyClient({
        registry: options.registry,
      }),
      path: options.path ?? DefaultToolApprovalPolicyPath,
    },
  });
}
