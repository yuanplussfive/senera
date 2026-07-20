import type { PolicyClient } from "@ai-sdk/policy-opa";
import { moduleDirPath } from "../Core/AgentPath.js";
import type { AgentPluginRegistry } from "../Plugin/AgentPluginRegistry.js";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";
import {
  AgentToolApprovalPolicyArtifactContract,
  type AgentToolApprovalPolicyArtifactBundle,
  type AgentToolApprovalPolicyData,
  readAgentToolApprovalPolicyArtifact,
  readAgentToolApprovalPolicyData,
} from "./AgentToolApprovalPolicyArtifact.js";
import { projectAgentToolFallbackSubject } from "../ToolRuntime/AgentToolFallbackContext.js";
import { createAgentOpaWasmPolicyClient } from "./AgentOpaWasmPolicyClient.js";

export interface AgentSeneraOpaPolicyClientOptions {
  readonly registry: AgentPluginRegistry;
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
}

interface AgentExecutionFallbackPolicyInputShape {
  readonly tool?: {
    readonly name?: unknown;
    readonly registered?: unknown;
    readonly plugin?: {
      readonly manifestDigest?: unknown;
      readonly [key: string]: unknown;
    };
  };
  readonly execution?: Record<string, unknown>;
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
      this.wasmLoadFailure = error instanceof Error ? error.message : String(error);
      return undefined;
    }
  }
}

function evaluateFailClosedPolicy(
  pathName: string,
  input:
    AgentToolApprovalPolicyInputShape | AgentExecutionFallbackPolicyInputShape | AgentResourceAccessPolicyInputShape,
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
  if (pathName === data.Entrypoints.ExecutionFallback) {
    const facts = buildFacts(input as AgentToolApprovalPolicyInputShape);
    return decision("deny", "execution.fallback.policy_unavailable", data.Reasons.FallbackDefaultDeny, facts);
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
  registry: AgentPluginRegistry,
): AgentToolApprovalPolicyInputShape | AgentExecutionFallbackPolicyInputShape | AgentResourceAccessPolicyInputShape {
  if (pathName === AgentToolApprovalPolicyArtifactContract.entrypoints.toolDecision) {
    return enrichPolicyInput(readPolicyInput(input), registry);
  }
  if (pathName === AgentToolApprovalPolicyArtifactContract.entrypoints.executionFallback) {
    return enrichFallbackPolicyInput(readFallbackPolicyInput(input), registry);
  }
  if (pathName === AgentToolApprovalPolicyArtifactContract.entrypoints.resourceAccess) {
    return readResourceAccessPolicyInput(input);
  }
  return readPolicyInput(input);
}

function enrichFallbackPolicyInput(
  input: AgentExecutionFallbackPolicyInputShape,
  registry: AgentPluginRegistry,
): AgentExecutionFallbackPolicyInputShape {
  const toolName = readString(input.tool?.name);
  const tool = toolName ? registry.getTool(toolName) : undefined;
  const subject = tool ? projectAgentToolFallbackSubject(tool) : undefined;
  const suppliedDigest = readString(input.tool?.plugin?.manifestDigest);
  const registered = Boolean(subject && suppliedDigest === subject.manifestDigest);

  return {
    tool: {
      name: toolName,
      registered,
      plugin: subject
        ? {
            name: subject.pluginName,
            title: subject.pluginTitle,
            version: subject.pluginVersion,
            manifestDigest: subject.manifestDigest,
            rootKind: subject.rootKind,
            trustLevel: subject.trustLevel,
          }
        : undefined,
    },
    execution: {
      ...input.execution,
      boundary: subject?.boundary,
      localFallback: tool?.execution.LocalFallback,
      network: subject?.network,
      workspace: subject?.workspace,
      permissions: subject?.permissions ?? [],
    },
  };
}

function enrichPolicyInput(
  input: AgentToolApprovalPolicyInputShape,
  registry: AgentPluginRegistry,
): AgentToolApprovalPolicyInputShape {
  const toolName = readString(input.tool?.name);
  const tool = toolName ? registry.getTool(toolName) : undefined;
  const risks = [...readRiskRecords(input.tool?.capabilities?.risks), ...registeredToolRisks(tool)];
  const effects = [
    ...readStringArray(input.tool?.capabilities?.effects),
    ...registeredToolEffects(tool),
    ...risks.flatMap((risk) => readString(risk.SideEffect) ?? []),
  ];

  return {
    ...input,
    tool: {
      ...input.tool,
      name: toolName,
      registered: Boolean(tool),
      approval: tool?.approval ?? input.tool?.approval,
      permissions: uniqueStrings([...readStringArray(input.tool?.permissions), ...(tool?.permissions ?? [])]),
      capabilities: {
        risks,
        effects: uniqueStrings(effects),
      },
      security: tool?.plugin.manifest.Security ?? input.tool?.security,
    } as AgentToolApprovalPolicyInputShape["tool"] & { registered: boolean },
  };
}

function buildFacts(input: AgentToolApprovalPolicyInputShape): AgentToolApprovalFacts {
  const approval = input.tool?.approval;
  const security = input.tool?.security;
  const risks = readRiskRecords(input.tool?.capabilities?.risks);

  return {
    approvalMode: readString(approval?.Mode),
    approvalReason: readString(approval?.Reason),
    toolRegistered: input.tool && "registered" in input.tool ? input.tool.registered === true : false,
    securityRequiresApproval: security?.RequiresApproval === true,
    trustLevel: readString(security?.TrustLevel),
    toolPermissions: readStringArray(input.tool?.permissions),
    riskPermissions: uniqueStrings(risks.flatMap((risk) => readString(risk.Permission) ?? [])),
    riskSideEffects: uniqueStrings([
      ...readStringArray(input.tool?.capabilities?.effects),
      ...risks.flatMap((risk) => readString(risk.SideEffect) ?? []),
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

function readFallbackPolicyInput(input: unknown): AgentExecutionFallbackPolicyInputShape {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as AgentExecutionFallbackPolicyInputShape)
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

function readStringArray(values: readonly unknown[] | undefined): string[] {
  return (values ?? []).flatMap((value) => readString(value) ?? []);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
