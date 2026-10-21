import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import { createAgentAiSdkGuardrailAuditor } from "./AgentAiSdkGuardrailAuditor.js";
import { AgentCompositeToolApprovalPolicy } from "./AgentToolApprovalPolicy.js";
import type { AgentToolGuardrailAuditor } from "./AgentToolGuardrailAudit.js";
import { AgentSeneraOpaPolicyClient } from "./AgentSeneraOpaPolicyClient.js";

import { AgentToolApprovalPolicyArtifactContract } from "./AgentToolApprovalPolicyArtifact.js";
import type { PolicyClient } from "@ai-sdk/policy-opa";

const DefaultToolApprovalPolicyPath = AgentToolApprovalPolicyArtifactContract.entrypoints.toolDecision;

export interface AgentToolApprovalPolicyFactoryOptions {
  readonly registry: AgentExtensionRegistry;
  readonly semanticAuditors?: readonly AgentToolGuardrailAuditor[];
  readonly path?: string;
  readonly policyClient?: PolicyClient;
}

export function createAgentToolApprovalPolicy(
  options: AgentToolApprovalPolicyFactoryOptions,
): AgentCompositeToolApprovalPolicy {
  return new AgentCompositeToolApprovalPolicy({
    deterministicAuditors: [createAgentAiSdkGuardrailAuditor()],
    semanticAuditors: options.semanticAuditors,
    opa: {
      client:
        options.policyClient ??
        new AgentSeneraOpaPolicyClient({
          registry: options.registry,
        }),
      path: options.path ?? DefaultToolApprovalPolicyPath,
    },
  });
}
