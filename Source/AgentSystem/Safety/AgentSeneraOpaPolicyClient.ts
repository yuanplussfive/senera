import fs from "node:fs";
import path from "node:path";
import {
  wasmPolicyClient,
  type PolicyClient,
} from "@ai-sdk/policy-opa";
import { moduleDirPath } from "../Core/AgentPath.js";
import type { AgentPluginRegistry } from "../Plugin/AgentPluginRegistry.js";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";

export interface AgentSeneraOpaPolicyClientOptions {
  readonly registry: AgentPluginRegistry;
  readonly policyData?: AgentToolApprovalPolicyData;
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

export interface AgentToolApprovalPolicyData {
  readonly Entrypoints: {
    readonly ToolDecision: string;
  };
  readonly Reasons: Record<
    | "ManifestDeny"
    | "ManifestAsk"
    | "ManifestAllow"
    | "MissingTool"
    | "RequiresApproval"
    | "Untrusted"
    | "RiskPermission"
    | "RiskSideEffect"
    | "ToolPermission"
    | "DefaultAllow",
    string
  >;
  readonly HighImpact: {
    readonly RiskPermissions: readonly string[];
    readonly RiskSideEffects: readonly string[];
    readonly ToolPermissionTerms: readonly string[];
  };
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

type LocalPolicyRule = (
  facts: AgentToolApprovalFacts,
  data: AgentToolApprovalPolicyData,
) => AgentSeneraOpaDecision | undefined;

const PolicyDataFileName = "AgentToolApprovalPolicy.data.json";
const PolicyWasmFileName = "AgentToolApprovalPolicy.wasm";

const LocalPolicyRules: readonly LocalPolicyRule[] = [
  (facts, data) => facts.approvalMode === "deny"
    ? decision("deny", "tool.manifest.deny", facts.approvalReason ?? data.Reasons.ManifestDeny, facts)
    : undefined,
  (facts, data) => facts.approvalMode === "ask"
    ? decision("requires-approval", "tool.manifest.ask", facts.approvalReason ?? data.Reasons.ManifestAsk, facts)
    : undefined,
  (facts, data) => facts.approvalMode === "allow"
    ? decision("allow", "tool.manifest.allow", facts.approvalReason ?? data.Reasons.ManifestAllow, facts)
    : undefined,
  (facts, data) => !facts.toolRegistered
    ? decision("requires-approval", "tool.registry.missing", data.Reasons.MissingTool, facts)
    : undefined,
  (facts, data) => facts.securityRequiresApproval
    ? decision("requires-approval", "plugin.security.requires_approval", data.Reasons.RequiresApproval, facts)
    : undefined,
  (facts, data) => facts.trustLevel === "Untrusted"
    ? decision("requires-approval", "plugin.security.untrusted", data.Reasons.Untrusted, facts)
    : undefined,
  (facts, data) => intersects(facts.riskPermissions, data.HighImpact.RiskPermissions)
    ? decision("requires-approval", "risk.permission.high_impact", data.Reasons.RiskPermission, facts)
    : undefined,
  (facts, data) => intersects(facts.riskSideEffects, data.HighImpact.RiskSideEffects)
    ? decision("requires-approval", "risk.side_effect.persistent_or_process", data.Reasons.RiskSideEffect, facts)
    : undefined,
  (facts, data) => containsAnyText(facts.toolPermissions, data.HighImpact.ToolPermissionTerms)
    ? decision("requires-approval", "tool.permission.high_impact", data.Reasons.ToolPermission, facts)
    : undefined,
  (facts, data) => facts.toolRegistered
    ? decision("allow", "risk.default.allow", data.Reasons.DefaultAllow, facts)
    : undefined,
];

export class AgentSeneraOpaPolicyClient implements PolicyClient {
  private readonly policyData: AgentToolApprovalPolicyData;
  private readonly wasmPath = path.join(moduleDirPath(import.meta.url), PolicyWasmFileName);
  private wasmClient: Promise<PolicyClient | undefined> | undefined;

  constructor(private readonly options: AgentSeneraOpaPolicyClientOptions) {
    this.policyData = options.policyData ?? readDefaultPolicyData();
  }

  async evaluate<TInput = unknown, TResult = unknown>(
    pathName: string,
    input: TInput,
  ): Promise<TResult> {
    const policyInput = enrichPolicyInput(readPolicyInput(input), this.options.registry);
    const wasmClient = await this.loadWasmClient();
    const result = wasmClient
      ? await wasmClient.evaluate(pathName, policyInput)
      : evaluateLocalPolicy(pathName, policyInput, this.policyData);

    return result as TResult;
  }

  private async loadWasmClient(): Promise<PolicyClient | undefined> {
    this.wasmClient ??= fs.existsSync(this.wasmPath)
      ? fs.promises.readFile(this.wasmPath)
        .then((wasm) => wasmPolicyClient({
          wasm,
          data: {
            senera: {
              tool_approval: this.policyData,
            },
          },
        }))
      : Promise.resolve(undefined);
    return this.wasmClient;
  }
}

function evaluateLocalPolicy(
  pathName: string,
  input: AgentToolApprovalPolicyInputShape,
  data: AgentToolApprovalPolicyData,
): AgentSeneraOpaDecision {
  if (pathName !== data.Entrypoints.ToolDecision) {
    return {
      decision: "not-applicable",
      reason: `未注册策略入口：${pathName}`,
      rule: "entrypoint.not_registered",
    };
  }

  const facts = buildFacts(input);
  return LocalPolicyRules
    .map((rule) => rule(facts, data))
    .find((result) => Boolean(result))
    ?? {
      decision: "not-applicable",
      reason: "没有匹配的工具审批策略。",
      rule: "default.not_applicable",
      riskSignals: riskSignals(facts),
    };
}

function enrichPolicyInput(
  input: AgentToolApprovalPolicyInputShape,
  registry: AgentPluginRegistry,
): AgentToolApprovalPolicyInputShape {
  const toolName = readString(input.tool?.name);
  const tool = toolName ? registry.getTool(toolName) : undefined;
  const risks = [
    ...readRiskRecords(input.tool?.capabilities?.risks),
    ...registeredToolRisks(tool),
  ];
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
      approval: input.tool?.approval ?? tool?.approval,
      permissions: uniqueStrings([
        ...readStringArray(input.tool?.permissions),
        ...(tool?.permissions ?? []),
      ]),
      capabilities: {
        risks,
        effects: uniqueStrings(effects),
      },
      security: input.tool?.security ?? tool?.plugin.manifest.Security,
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
    toolRegistered: input.tool && "registered" in input.tool
      ? input.tool.registered === true
      : false,
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
  return (tool?.search?.Capabilities ?? []).flatMap((capability) =>
    capability.Risk ? [capability.Risk] : []
  );
}

function registeredToolEffects(tool: RegisteredTool | undefined): string[] {
  return (tool?.search?.Capabilities ?? []).flatMap((capability) => capability.Facets?.Effects ?? []);
}

function readDefaultPolicyData(): AgentToolApprovalPolicyData {
  const filePath = path.join(moduleDirPath(import.meta.url), PolicyDataFileName);
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as AgentToolApprovalPolicyData;
}

function readPolicyInput(input: unknown): AgentToolApprovalPolicyInputShape {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as AgentToolApprovalPolicyInputShape
    : {};
}

function readRiskRecords(values: readonly unknown[] | undefined): Array<{
  readonly Permission?: unknown;
  readonly SideEffect?: unknown;
}> {
  return (values ?? []).flatMap((value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? [value as { readonly Permission?: unknown; readonly SideEffect?: unknown }]
      : []
  );
}

function intersects(left: readonly string[], right: readonly string[]): boolean {
  const values = new Set(left);
  return right.some((value) => values.has(value));
}

function containsAnyText(values: readonly string[], needles: readonly string[]): boolean {
  return values.some((value) => needles.some((needle) => value.includes(needle)));
}

function readStringArray(values: readonly unknown[] | undefined): string[] {
  return (values ?? []).flatMap((value) => readString(value) ?? []);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0
    ? value
    : undefined;
}
