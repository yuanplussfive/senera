import fs from "node:fs";
import path from "node:path";
import { ToolRiskAuditDecision, ToolRiskLevel } from "../BamlClient/baml_client/index.js";
import type { AgentActionPlannerModelClient } from "../ActionPlanner/AgentActionPlannerModelClient.js";
import { AgentCancellationError, throwIfAborted } from "../Core/AgentCancellation.js";
import { moduleDirPath } from "../Core/AgentPath.js";
import { AgentPermissionActions, type AgentPermissionDecision } from "./AgentSafetyTypes.js";
import type { AgentToolApprovalPolicyInput } from "./AgentToolApprovalPolicy.js";
import type { AgentToolGuardrailAuditor } from "./AgentToolGuardrailAudit.js";
import type { AgentBamlToolRiskAuditProfile } from "./AgentBamlToolRiskAuditPromptJson.js";
import { projectToolRiskAuditPromptInput } from "./AgentBamlToolRiskAuditPromptJson.js";
import { parseToolRiskAudit, parseToolRiskAuditProfile } from "./AgentBamlToolRiskAuditSchema.js";

const ProfileFileName = "AgentBamlToolRiskAuditProfile.json";

type InterruptingToolRiskDecision = Exclude<ToolRiskAuditDecision, typeof ToolRiskAuditDecision.Allow>;

const PermissionActionByAuditDecision = {
  [ToolRiskAuditDecision.Ask]: AgentPermissionActions.Ask,
  [ToolRiskAuditDecision.Deny]: AgentPermissionActions.Deny,
} satisfies Record<InterruptingToolRiskDecision, AgentPermissionDecision["action"]>;

export interface AgentBamlToolRiskAuditorOptions {
  readonly client: Pick<AgentActionPlannerModelClient, "auditToolRisk">;
  readonly profile?: AgentBamlToolRiskAuditProfile;
}

export class AgentBamlToolRiskAuditor implements AgentToolGuardrailAuditor {
  private readonly profile: AgentBamlToolRiskAuditProfile;

  constructor(private readonly options: AgentBamlToolRiskAuditorOptions) {
    this.profile = options.profile ?? readDefaultProfile();
  }

  async auditToolCall(input: AgentToolApprovalPolicyInput): Promise<AgentPermissionDecision | undefined> {
    try {
      throwIfAborted(input.signal);
      const audit = parseToolRiskAudit(
        await this.options.client.auditToolRisk(
          projectToolRiskAuditPromptInput({
            input,
            profile: this.profile,
          }),
          {
            signal: input.signal,
          },
        ),
      );

      return audit.decision === ToolRiskAuditDecision.Allow
        ? undefined
        : {
            action: PermissionActionByAuditDecision[audit.decision],
            rule: `baml-tool-risk.${audit.decision.toLowerCase()}`,
            reason: audit.reason,
            riskSignals: riskSignals(audit),
          };
    } catch (error) {
      if (error instanceof AgentCancellationError || input.signal?.aborted) {
        throw error;
      }
      return undefined;
    }
  }
}

export function createAgentBamlToolRiskAuditor(options: AgentBamlToolRiskAuditorOptions): AgentBamlToolRiskAuditor {
  return new AgentBamlToolRiskAuditor(options);
}

function readDefaultProfile(): AgentBamlToolRiskAuditProfile {
  return parseToolRiskAuditProfile(
    JSON.parse(fs.readFileSync(path.join(moduleDirPath(import.meta.url), ProfileFileName), "utf8")),
  );
}

function riskSignals(audit: ReturnType<typeof parseToolRiskAudit>): string[] {
  return [
    `baml.riskLevel:${audit.riskLevel}`,
    `baml.confidence:${audit.confidence.toFixed(2)}`,
    `baml.tripwire:${String(audit.tripwire)}`,
    ...audit.matchedConcerns.map((concern) => `baml.concern:${concern}`),
    ...criticalitySignals(audit.riskLevel),
  ];
}

function criticalitySignals(level: ToolRiskLevel): string[] {
  return level === ToolRiskLevel.Critical ? ["baml.critical"] : [];
}
