import { z } from "zod";
import {
  BamlAbortError,
  BamlTimeoutError,
} from "@boundaryml/baml";
import {
  ActionKind,
  BamlClientFinishReasonError,
  BamlClientHttpError,
  BamlValidationError,
  type ActionDecision as BamlActionDecision,
  type ActionPlanInput,
} from "./BamlClient/baml_client/index.js";
import type { AgentToolCatalogItem } from "./AgentToolCatalogProjector.js";
import type {
  ResolvedAgentActionPlannerConfig,
  ResolvedAgentModelProviderConfig,
} from "./Types.js";
import { AgentActionPlannerModelClient } from "./AgentActionPlannerModelClient.js";

const ActionDecisionSchema = z
  .object({
    action: z.enum(ActionKind),
    intent: z.string(),
    progressAssessment: z.string(),
    nextStepGoal: z.string(),
    requiredCapabilities: z.array(z.string()),
    tags: z.array(z.string()),
    toolSearchQueries: z.array(z.string()),
    preferredTools: z.array(z.string()),
    confidence: z.number().min(0).max(1),
    instructionToMainModel: z.string(),
  })
  .strict()
  .superRefine((decision, context) => {
    if (decision.action === ActionKind.DiscoverTools && decision.toolSearchQueries.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["toolSearchQueries"],
        message: "DiscoverTools 需要至少一个工具搜索 query。",
      });
    }

    if (decision.action === ActionKind.UseTools && decision.preferredTools.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["preferredTools"],
        message: "UseTools 需要至少一个 preferredTools。",
      });
    }
  });

export type AgentActionKind =
  | "answer"
  | "ask_user"
  | "discover_tools"
  | "use_tools";

export interface AgentActionDecision {
  action: AgentActionKind;
  intent: string;
  progressAssessment: string;
  nextStepGoal: string;
  requiredCapabilities: string[];
  tags: string[];
  toolSearchQueries: string[];
  preferredTools: string[];
  confidence: number;
  instructionToMainModel: string;
}

export type AgentActionPlanResult =
  | {
      kind: "planned";
      decision: AgentActionDecision;
      input: ActionPlanInput;
      repaired: boolean;
    }
  | {
      kind: "fallback";
      reason: string;
      input?: ActionPlanInput;
    };

interface RawActionPlanningFailure {
  error: unknown;
  invalidDecision?: unknown;
}

export class AgentActionPlanner {
  private readonly client: AgentActionPlannerModelClient;

  constructor(
    private readonly config: ResolvedAgentActionPlannerConfig,
    model: ResolvedAgentModelProviderConfig,
    private readonly catalog: {
      list(): AgentToolCatalogItem[];
    },
  ) {
    this.client = new AgentActionPlannerModelClient(model, config.Client);
  }

  async plan(options: {
    requestId: string;
    input: ActionPlanInput;
    signal?: AbortSignal;
  }): Promise<AgentActionPlanResult> {
    if (!this.isEnabled()) {
      return {
        kind: "fallback",
        reason: "disabled",
      };
    }

    const input = options.input;

    try {
      const decision = await this.client.plan(input);

      return {
        kind: "planned",
        decision: this.parse(decision),
        input,
        repaired: false,
      };
    } catch (error) {
      return this.repairOrFallback({
        input,
        signal: options.signal,
        failure: normalizePlanningFailure(error),
      });
    }
  }

  private async repairOrFallback(options: {
    input: ActionPlanInput;
    signal?: AbortSignal;
    failure: RawActionPlanningFailure;
  }): Promise<AgentActionPlanResult> {
    if (this.config.MaxRepairAttempts <= 0 || !isRepairablePlanningFailure(options.failure.error)) {
      return this.fallback(options.input, options.failure.error);
    }

    try {
      const repaired = await this.client.repair({
        input: options.input,
        invalidDecision: stringifyIssueValue(options.failure.invalidDecision ?? options.failure.error),
        issues: issueMessages(options.failure.error),
      });

      return {
        kind: "planned",
        decision: this.parse(repaired),
        input: options.input,
        repaired: true,
      };
    } catch (repairError) {
      return this.fallback(options.input, repairError);
    }
  }

  private fallback(input: ActionPlanInput, error: unknown): AgentActionPlanResult {
    return {
      kind: "fallback",
      reason: summarizePlannerFailure(error),
      input,
    };
  }

  private parse(decision: BamlActionDecision): AgentActionDecision {
    const parsed = ActionDecisionSchema.parse(decision);
    const knownTools = new Set(this.catalog.list().map((tool) => tool.name));
    const unknownTools = parsed.preferredTools.filter((tool) => !knownTools.has(tool));
    if (unknownTools.length > 0) {
      throw new AgentActionPlannerValidationError([
        `preferredTools 包含未注册工具：${unknownTools.join(", ")}`,
      ], decision);
    }

    return {
      action: ActionKindMap[parsed.action],
      intent: parsed.intent,
      progressAssessment: parsed.progressAssessment.trim(),
      nextStepGoal: parsed.nextStepGoal.trim(),
      requiredCapabilities: uniqueTrimmed(parsed.requiredCapabilities),
      tags: uniqueTrimmed(parsed.tags),
      toolSearchQueries: uniqueTrimmed(parsed.toolSearchQueries),
      preferredTools: uniqueTrimmed(parsed.preferredTools),
      confidence: parsed.confidence,
      instructionToMainModel: parsed.instructionToMainModel.trim(),
    };
  }

  private isEnabled(): boolean {
    return this.config.Enabled
      && Boolean(this.config.Client.BaseUrl.trim())
      && Boolean(this.config.Client.ApiKey.trim())
      && Boolean(this.config.Client.Model.trim());
  }
}

const ActionKindMap = {
  [ActionKind.Answer]: "answer",
  [ActionKind.AskUser]: "ask_user",
  [ActionKind.DiscoverTools]: "discover_tools",
  [ActionKind.UseTools]: "use_tools",
} satisfies Record<ActionKind, AgentActionKind>;

function uniqueTrimmed(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function issueMessages(error: unknown): string[] {
  if (error instanceof AgentActionPlannerValidationError) {
    return error.issues;
  }

  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "/"}: ${issue.message}`);
  }

  return [error instanceof Error ? error.message : String(error)];
}

function stringifyIssueValue(error: unknown): string {
  if (error instanceof AgentActionPlannerValidationError) {
    return JSON.stringify(error.invalidDecision, null, 2);
  }

  if (error instanceof z.ZodError) {
    return JSON.stringify(error.issues, null, 2);
  }

  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return JSON.stringify(error);
}

function normalizePlanningFailure(error: unknown): RawActionPlanningFailure {
  return error instanceof AgentActionPlannerValidationError
    ? {
        error,
        invalidDecision: error.invalidDecision,
      }
    : {
        error,
      };
}

function isRepairablePlanningFailure(error: unknown): boolean {
  return error instanceof AgentActionPlannerValidationError
    || error instanceof z.ZodError
    || error instanceof BamlValidationError;
}

function summarizePlannerFailure(error: unknown): string {
  if (error instanceof BamlTimeoutError) {
    return "action_planner_timeout";
  }

  if (error instanceof BamlClientHttpError) {
    return `action_planner_http_error${error.status_code > 0 ? `:${error.status_code}` : ""}`;
  }

  if (error instanceof BamlAbortError) {
    return "action_planner_aborted";
  }

  if (error instanceof BamlClientFinishReasonError) {
    return "action_planner_incomplete_output";
  }

  if (error instanceof BamlValidationError) {
    return "action_planner_invalid_structured_output";
  }

  if (error instanceof AgentActionPlannerValidationError || error instanceof z.ZodError) {
    return "action_planner_invalid_decision";
  }

  return error instanceof Error ? truncateOneLine(error.message, 160) : truncateOneLine(String(error), 160);
}

function truncateOneLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}

class AgentActionPlannerValidationError extends Error {
  constructor(
    readonly issues: string[],
    readonly invalidDecision: unknown,
  ) {
    super(issues.join("\n"));
    this.name = "AgentActionPlannerValidationError";
  }
}
