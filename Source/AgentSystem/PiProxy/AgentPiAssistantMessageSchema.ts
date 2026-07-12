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
    answer: z.string().optional(),
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
  },
): ParsedPiControllerAction {
  const parsed = safeParseNormalizedBamlOutput(PiControllerActionSchema, value);
  if (!parsed.success) {
    throw new AgentActionPlannerValidationError(parsed.structuredIssues, parsed.normalized);
  }

  const issues = validatePiControllerAction(parsed.data, options);
  if (issues.length > 0) {
    throw new AgentActionPlannerValidationError(issues, parsed.normalized);
  }

  return parsed.data;
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
      if (!action.answer?.trim()) {
        issues.push(createAgentStructuredIssue(agentErrorMessage("pi.finalAnswerMissingAnswer"), ["answer"]));
      }
      if (calls.length > 0) {
        issues.push(createAgentStructuredIssue(agentErrorMessage("pi.finalAnswerContainsCalls"), ["calls"]));
      }
    },
    AskUser: () => {
      if (!action.question?.trim()) {
        issues.push(createAgentStructuredIssue(agentErrorMessage("pi.askUserMissingQuestion"), ["question"]));
      }
      if (calls.length > 0) {
        issues.push(createAgentStructuredIssue(agentErrorMessage("pi.askUserContainsCalls"), ["calls"]));
      }
    },
    CallTools: () => {
      if (!action.preface?.trim()) {
        issues.push(createAgentStructuredIssue(agentErrorMessage("pi.callToolsMissingPreface"), ["preface"]));
      }
      if (calls.length === 0) {
        issues.push(createAgentStructuredIssue(agentErrorMessage("pi.callToolsMissingCalls"), ["calls"]));
      }
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
