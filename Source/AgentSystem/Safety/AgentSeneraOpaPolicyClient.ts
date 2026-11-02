import type { PolicyClient } from "@ai-sdk/policy-opa";
import { moduleDirPath } from "../Core/AgentPath.js";
import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import { resolveAgentToolOwner } from "../Types/AgentToolOwner.js";
import {
  AgentToolApprovalPolicyArtifactContract,
  type AgentToolApprovalPolicyArtifactBundle,
  type AgentToolApprovalPolicyData,
  readAgentToolApprovalPolicyArtifact,
  readAgentToolApprovalPolicyData,
} from "./AgentToolApprovalPolicyArtifact.js";
import { createAgentOpaWasmPolicyClient } from "./AgentOpaWasmPolicyClient.js";
import { readStringArray, uniqueStrings } from "../Core/AgentCollections.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { readAgentNonEmptyString } from "../Core/AgentUnknownValue.js";

export interface AgentSeneraOpaPolicyClientOptions {
  readonly registry: AgentExtensionRegistry;
  readonly artifactLoader?: () =>
    AgentToolApprovalPolicyArtifactBundle | Promise<AgentToolApprovalPolicyArtifactBundle>;
}

export type AgentSeneraOpaDecision =
  | {
      decision: "allow";
      reason?: string;
      rule?: string;
      riskSignals?: readonly string[];
    }
  | {
      decision: "deny";
      reason?: string;
      rule?: string;
      riskSignals?: readonly string[];
    }
  | {
      decision: "requires-approval";
      reason?: string;
      rule?: string;
      riskSignals?: readonly string[];
    }
  | {
      decision: "not-applicable";
      reason?: string;
      rule?: string;
      riskSignals?: readonly string[];
    };

interface AgentToolApprovalPolicyInputShape {
  readonly tool?: {
    readonly name?: unknown;
    readonly registered?: unknown;
    readonly approval?: {
      readonly Mode?: unknown;
      readonly Reason?: unknown;
    };
    readonly permissions?: readonly unknown[];
    readonly capabilities?: {
      readonly risks?: readonly unknown[];
      readonly effects?: readonly unknown[];
    };
    readonly security?: {
      readonly RequiresApproval?: unknown;
      readonly TrustLevel?: unknown;
    };
  };
  readonly execution?: {
    readonly target?: unknown;
    readonly availableTargets?: readonly unknown[];
  };
}

interface AgentResourceAccessPolicyInputShape {
  readonly resource?: Record<string, unknown>;
}

interface AgentToolApprovalFacts {
  readonly approvalMode?: string;
  readonly approvalReason?: string;
  readonly toolRegistered: boolean;
  readonly securityRequiresApproval: boolean;
  readonly trustLevel?: string;
  readonly toolPermissions: readonly string[];
  readonly riskPermissions: readonly string[];
  readonly riskSideEffects: readonly string[];
}

export class AgentSeneraOpaPolicyClient implements PolicyClient {
  private readonly policyData: AgentToolApprovalPolicyData;
  private wasmClient: Promise<PolicyClient | undefined> | undefined;
  private wasmLoadFailure: string | undefined;

  constructor(private readonly options: AgentSeneraOpaPolicyClientOptions) {
    this.policyData = readAgentToolApprovalPolicyData(moduleDirPath(import.meta.url));
  }

  async evaluate<TInput = unknown, TResult = unknown>(pathName: string, input: TInput): Promise<TResult> {
    const policyInput = projectPolicyInput(pathName, input, this.options.registry);
    const wasmClient = await this.loadWasmClient();
    const result = wasmClient
      ? await wasmClient.evaluate(pathName, policyInput)
      : evaluateFailClosedPolicy(pathName, policyInput, this.policyData, this.wasmLoadFailure);

    return result as TResult;
  }

  private async loadWasmClient(): Promise<PolicyClient | undefined> {
    this.wasmClient ??= this.createWasmClient();
    return this.wasmClient;
  }

  private async createWasmClient(): Promise<PolicyClient | undefined> {
    try {
      const artifact = await (this.options.artifactLoader?.() ??
        readAgentToolApprovalPolicyArtifact(moduleDirPath(import.meta.url)));
      return await createAgentOpaWasmPolicyClient({
        wasm: artifact.wasm,
        data: {
          senera: {
            tool_approval: artifact.data,
          },
        },
      });
    } catch (error) {
      this.wasmLoadFailure = errorMessage(error);
      return undefined;
    }
  }
}

function evaluateFailClosedPolicy(
  pathName: string,
  input: AgentToolApprovalPolicyInputShape | AgentResourceAccessPolicyInputShape,
  data: AgentToolApprovalPolicyData,
  loadFailure: string | undefined,
): AgentSeneraOpaDecision {
  if (pathName === data.Entrypoints.ResourceAccess) {
    return {
      decision: "deny",
      reason: [data.Reasons.ResourceUnresolved, loadFailure].filter(Boolean).join(" "),
      rule: "resource.policy_unavailable",
      riskSignals: ["resource.policy:unavailable"],
    };
  }
  const toolInput = input as AgentToolApprovalPolicyInputShape;
  const facts = buildFacts(toolInput);
  if (pathName !== data.Entrypoints.ToolDecision) {
    return decision("deny", "policy.entrypoint.mismatch", data.Reasons.EntrypointMismatch, facts);
  }

  if (facts.approvalMode === "deny") {
    return decision("deny", "tool.manifest.deny", facts.approvalReason ?? data.Reasons.ManifestDeny, facts);
  }

  return decision(
    "requires-approval",
    "policy.artifact.unavailable",
    [data.Reasons.PolicyUnavailable, loadFailure].filter(Boolean).join(" "),
    facts,
  );
}

function projectPolicyInput(
  pathName: string,
  input: unknown,
  registry: AgentExtensionRegistry,
): AgentToolApprovalPolicyInputShape | AgentResourceAccessPolicyInputShape {
  if (pathName === AgentToolApprovalPolicyArtifactContract.entrypoints.toolDecision) {
    return enrichPolicyInput(readPolicyInput(input), registry);
  }
  if (pathName === AgentToolApprovalPolicyArtifactContract.entrypoints.resourceAccess) {
    return readResourceAccessPolicyInput(input);
  }
  return readPolicyInput(input);
}

function enrichPolicyInput(
  input: AgentToolApprovalPolicyInputShape,
  registry: AgentExtensionRegistry,
): AgentToolApprovalPolicyInputShape {
  const toolName = readAgentNonEmptyString(input.tool?.name);
  const tool = toolName ? registry.getTool(toolName) : undefined;
  const risks = [...readRiskRecords(input.tool?.capabilities?.risks), ...registeredToolRisks(tool)];
  const effects = [
    ...readStringArray(input.tool?.capabilities?.effects, { rejectBlank: true }),
    ...registeredToolEffects(tool),
    ...risks.flatMap((risk) => readAgentNonEmptyString(risk.SideEffect) ?? []),
  ];

  return {
    ...input,
    tool: {
      ...input.tool,
      name: toolName,
      registered: Boolean(tool),
      approval: tool?.approval ?? input.tool?.approval,
      permissions: uniqueStrings([
        ...readStringArray(input.tool?.permissions, { rejectBlank: true }),
        ...(tool?.permissions ?? []),
      ]),
      capabilities: {
        risks,
        effects: uniqueStrings(effects),
      },
      security: tool
        ? {
            TrustLevel: resolveAgentToolOwner(tool).trusted ? "System" : "External",
            RequiresApproval: resolveAgentToolOwner(tool).requiresApproval,
          }
        : input.tool?.security,
    } as AgentToolApprovalPolicyInputShape["tool"] & { registered: boolean },
    execution: {
      target: readAgentNonEmptyString(input.execution?.target),
      availableTargets:
        tool?.execution.Targets ?? readStringArray(input.execution?.availableTargets, { rejectBlank: true }),
    },
  };
}

function buildFacts(input: AgentToolApprovalPolicyInputShape): AgentToolApprovalFacts {
  const approval = input.tool?.approval;
  const security = input.tool?.security;
  const risks = readRiskRecords(input.tool?.capabilities?.risks);

  return {
    approvalMode: readAgentNonEmptyString(approval?.Mode),
    approvalReason: readAgentNonEmptyString(approval?.Reason),
    toolRegistered: input.tool && "registered" in input.tool ? input.tool.registered === true : false,
    securityRequiresApproval: security?.RequiresApproval === true,
    trustLevel: readAgentNonEmptyString(security?.TrustLevel),
    toolPermissions: readStringArray(input.tool?.permissions, { rejectBlank: true }),
    riskPermissions: uniqueStrings(risks.flatMap((risk) => readAgentNonEmptyString(risk.Permission) ?? [])),
    riskSideEffects: uniqueStrings([
      ...readStringArray(input.tool?.capabilities?.effects, { rejectBlank: true }),
      ...risks.flatMap((risk) => readAgentNonEmptyString(risk.SideEffect) ?? []),
    ]),
  };
}

function decision(
  decisionValue: AgentSeneraOpaDecision["decision"],
  rule: string,
  reason: string,
  facts: AgentToolApprovalFacts,
): AgentSeneraOpaDecision {
  return {
    decision: decisionValue,
    reason,
    rule,
    riskSignals: riskSignals(facts),
  };
}

function riskSignals(facts: AgentToolApprovalFacts): string[] {
  return [
    ...facts.toolPermissions.map((value) => `tool.permission:${value}`),
    ...facts.riskPermissions.map((value) => `risk.permission:${value}`),
    ...facts.riskSideEffects.map((value) => `risk.sideEffect:${value}`),
    ...(facts.trustLevel ? [`security.trustLevel:${facts.trustLevel}`] : []),
    ...(facts.securityRequiresApproval ? ["security.requiresApproval:true"] : []),
  ];
}

function registeredToolRisks(tool: RegisteredTool | undefined): Array<{
  readonly Permission?: unknown;
  readonly SideEffect?: unknown;
}> {
  return (tool?.search?.Capabilities ?? []).flatMap((capability) => (capability.Risk ? [capability.Risk] : []));
}

function registeredToolEffects(tool: RegisteredTool | undefined): string[] {
  return (tool?.search?.Capabilities ?? []).flatMap((capability) => capability.Facets?.Effects ?? []);
}

function readPolicyInput(input: unknown): AgentToolApprovalPolicyInputShape {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as AgentToolApprovalPolicyInputShape)
    : {};
}

function readResourceAccessPolicyInput(input: unknown): AgentResourceAccessPolicyInputShape {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as AgentResourceAccessPolicyInputShape)
    : {};
}

function readRiskRecords(values: readonly unknown[] | undefined): Array<{
  readonly Permission?: unknown;
  readonly SideEffect?: unknown;
}> {
  return (values ?? []).flatMap((value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? [value as { readonly Permission?: unknown; readonly SideEffect?: unknown }]
      : [],
  );
}
