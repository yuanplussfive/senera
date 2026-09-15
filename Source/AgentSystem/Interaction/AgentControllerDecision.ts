import { z } from "zod";
import type { ControllerDecision as BamlControllerDecision } from "../BamlClient/baml_client/index.js";
import { safeParseNormalizedBamlOutput } from "../BamlClient/AgentBamlOutputNormalizer.js";
import { createAgentStructuredIssue, type AgentStructuredIssue } from "../Diagnostics/AgentStructuredIssue.js";
import { AgentStructuredOutputValidationError } from "../Diagnostics/AgentStructuredOutputValidationError.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";

const NonEmptyStringSchema = z.string().trim().min(1);

const PlannedToolCallSchema = z
  .object({
    toolName: NonEmptyStringSchema,
    purpose: NonEmptyStringSchema,
    required: z.boolean(),
    dependsOn: z.array(z.number().int().nonnegative()).optional(),
  })
  .strict();

export const ControllerDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("Direct"), response: NonEmptyStringSchema }).strict(),
  z.object({ kind: z.literal("AskUser"), question: NonEmptyStringSchema }).strict(),
  z
    .object({
      kind: z.literal("Execute"),
      fragment: z
        .object({
          preface: NonEmptyStringSchema,
          calls: z.array(PlannedToolCallSchema).min(1),
        })
        .strict(),
    })
    .strict(),
]);

export type ParsedControllerDecision = z.infer<typeof ControllerDecisionSchema>;

export function parseControllerDecision(
  value: BamlControllerDecision | unknown,
  options: { allowedTools: readonly string[] },
): ParsedControllerDecision {
  const parsed = safeParseNormalizedBamlOutput(ControllerDecisionSchema, value);
  if (!parsed.success) {
    throw new AgentStructuredOutputValidationError(parsed.structuredIssues, parsed.normalized);
  }

  const issues = validateControllerDecision(parsed.data, options.allowedTools);
  if (issues.length > 0) {
    throw new AgentStructuredOutputValidationError(issues, parsed.normalized);
  }
  return parsed.data;
}

function validateControllerDecision(
  decision: ParsedControllerDecision,
  allowedToolNames: readonly string[],
): AgentStructuredIssue[] {
  if (decision.kind !== "Execute") return [];

  const allowedTools = new Set(allowedToolNames);
  return decision.fragment.calls.flatMap((call, index) => {
    const issues: AgentStructuredIssue[] = [];
    if (!allowedTools.has(call.toolName)) {
      issues.push(
        createAgentStructuredIssue(agentErrorMessage("pi.toolNotAllowed", { toolName: call.toolName }), [
          "fragment",
          "calls",
          index,
          "toolName",
        ]),
      );
    }
    if ((call.dependsOn ?? []).some((dependency) => dependency >= index)) {
      issues.push(
        createAgentStructuredIssue(agentErrorMessage("pi.dependsOnMustReferenceEarlierCall"), [
          "fragment",
          "calls",
          index,
          "dependsOn",
        ]),
      );
    }
    return issues;
  });
}
