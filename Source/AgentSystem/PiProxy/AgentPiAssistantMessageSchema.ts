import { z } from "zod";
import { AgentActionPlannerValidationError } from "../ActionPlanner/AgentActionPlannerSchema.js";
import { safeParseNormalizedBamlOutput } from "../BamlClient/AgentBamlOutputNormalizer.js";
import { createAgentStructuredIssue, type AgentStructuredIssue } from "../Diagnostics/AgentStructuredIssue.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";

type JsonValue = string | number | boolean | JsonValue[] | JsonObject;

interface JsonObject {
  [key: string]: JsonValue;
}

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema)]),
);

const PiPlannedToolCallSchema = z
  .object({
    toolName: z.string().trim().min(1),
    purpose: z.string().trim().min(1),
    required: z.boolean(),
    dependsOn: z.array(z.number().int().nonnegative()).optional(),
    argumentHints: z.record(z.string(), JsonValueSchema).optional(),
  })
  .strict();

const PiControllerActionSchema = z
  .object({
    kind: z.enum(["FinalAnswer", "AskUser", "CallTools"]),
    answerPlan: z.array(z.string().trim().min(1)).optional(),
    question: z.string().optional(),
    preface: z.string().optional(),
    calls: z.array(PiPlannedToolCallSchema).optional(),
  })
  .strict();

const PiToolArgumentsDraftSchema = z
  .object({
    arguments: z.record(z.string(), JsonValueSchema),
    missingInputs: z.array(z.string()),
    assumptions: z.array(z.string()),
  })
  .strict();

export type ParsedPiControllerAction = z.infer<typeof PiControllerActionSchema>;
export type ParsedPiToolArgumentsDraft = z.infer<typeof PiToolArgumentsDraftSchema>;

export function parsePiControllerAction(
  value: unknown,
  options: {
    allowedTools: readonly string[];
    implicitFinalAnswerPlan?: string;
  },
): ParsedPiControllerAction {
  const parsed = safeParseNormalizedBamlOutput(
    PiControllerActionSchema,
    projectImplicitFinalAnswerPlan(value, options.implicitFinalAnswerPlan),
  );
  if (!parsed.success) {
    throw new AgentActionPlannerValidationError(parsed.structuredIssues, parsed.normalized);
  }

  const issues = validatePiControllerAction(parsed.data, options);
  if (issues.length > 0) {
    throw new AgentActionPlannerValidationError(issues, parsed.normalized);
  }

  return parsed.data;
}

function projectImplicitFinalAnswerPlan(value: unknown, plan: string | undefined): unknown {
  if (!plan || !value || typeof value !== "object" || Array.isArray(value)) return value;
  const action = value as Record<string, unknown>;
  return action.kind === "FinalAnswer" && action.answerPlan == null ? { ...action, answerPlan: [plan] } : value;
}

export function parsePiToolArgumentsDraft(value: unknown): ParsedPiToolArgumentsDraft {
  const parsed = safeParseNormalizedBamlOutput(PiToolArgumentsDraftSchema, value);
  if (!parsed.success) {
    throw new AgentActionPlannerValidationError(parsed.structuredIssues, parsed.normalized);
  }

  return parsed.data;
}

function validatePiControllerAction(
  action: ParsedPiControllerAction,
  options: {
    allowedTools: readonly string[];
  },
): AgentStructuredIssue[] {
  const issues: AgentStructuredIssue[] = [];
  const allowedTools = new Set(options.allowedTools);
  const calls = action.calls ?? [];

  const validators = {
    FinalAnswer: () => {
      if (!action.answerPlan?.length) {
        issues.push(createAgentStructuredIssue(agentErrorMessage("pi.finalAnswerMissingPlan"), ["answerPlan"]));
      }
      if (calls.length > 0) {
        issues.push(createAgentStructuredIssue(agentErrorMessage("pi.finalAnswerContainsCalls"), ["calls"]));
      }
      rejectFields(action, ["question", "preface"], issues);
    },
    AskUser: () => {
      if (!action.question?.trim()) {
        issues.push(createAgentStructuredIssue(agentErrorMessage("pi.askUserMissingQuestion"), ["question"]));
      }
      if (calls.length > 0) {
        issues.push(createAgentStructuredIssue(agentErrorMessage("pi.askUserContainsCalls"), ["calls"]));
      }
      rejectFields(action, ["answerPlan", "preface"], issues);
    },
    CallTools: () => {
      if (!action.preface?.trim()) {
        issues.push(createAgentStructuredIssue(agentErrorMessage("pi.callToolsMissingPreface"), ["preface"]));
      }
      if (calls.length === 0) {
        issues.push(createAgentStructuredIssue(agentErrorMessage("pi.callToolsMissingCalls"), ["calls"]));
      }
      rejectFields(action, ["answerPlan", "question"], issues);
    },
  } satisfies Record<ParsedPiControllerAction["kind"], () => void>;

  validators[action.kind]();
  calls.forEach((call, index) => {
    if (!allowedTools.has(call.toolName)) {
      issues.push(
        createAgentStructuredIssue(
          agentErrorMessage("pi.toolNotAllowed", {
            toolName: call.toolName,
          }),
          ["calls", index, "toolName"],
        ),
      );
    }

    for (const dependency of call.dependsOn ?? []) {
      if (dependency >= index) {
        issues.push(
          createAgentStructuredIssue(agentErrorMessage("pi.dependsOnMustReferenceEarlierCall"), [
            "calls",
            index,
            "dependsOn",
          ]),
        );
      }
    }
  });

  return issues;
}

function rejectFields(
  action: ParsedPiControllerAction,
  fields: readonly (keyof ParsedPiControllerAction)[],
  issues: AgentStructuredIssue[],
): void {
  for (const field of fields) {
    if (action[field] !== undefined) {
      issues.push(
        createAgentStructuredIssue(agentErrorMessage("pi.actionContainsIncompatibleField", { field }), [field]),
      );
    }
  }
}
