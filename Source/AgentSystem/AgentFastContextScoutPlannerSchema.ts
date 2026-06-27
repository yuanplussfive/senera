import { z } from "zod";
import type {
  FastContextScoutPlannerDecision,
} from "./BamlClient/baml_client/types.js";
import type {
  AgentFastContextScoutPlannerPromptInput,
} from "./AgentFastContextScoutPlannerPromptJson.js";
import { safeParseNormalizedBamlOutput } from "./AgentBamlOutputNormalizer.js";

const ScoutCommandSchema = z
  .object({
    type: z.string().trim().min(1),
    pattern: z.string().trim().min(1).optional(),
    path: z.string().trim().min(1).optional(),
    include: z.array(z.string().trim().min(1)).optional(),
    exclude: z.array(z.string().trim().min(1)).optional(),
    regex: z.boolean().optional(),
    caseSensitive: z.boolean().optional(),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
    depth: z.number().int().positive().optional(),
  })
  .strict();

const ScoutFileSelectionSchema = z
  .object({
    path: z.string().trim().min(1),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    reason: z.string().trim().min(1),
  })
  .strict()
  .refine((file) => file.endLine >= file.startLine, {
    message: "endLine must be greater than or equal to startLine.",
    path: ["endLine"],
  });

const ScoutPlannerDecisionSchema = z
  .object({
    action: z.enum(["commands", "final"]),
    commands: z.array(ScoutCommandSchema),
    files: z.array(ScoutFileSelectionSchema),
    reason: z.string().trim().min(1),
  })
  .strict()
  .superRefine((decision, context) => {
    if (decision.action === "commands" && decision.commands.length === 0) {
      context.addIssue({
        code: "custom",
        message: "commands action requires at least one command.",
        path: ["commands"],
      });
    }
    if (decision.action === "final" && decision.files.length === 0) {
      context.addIssue({
        code: "custom",
        message: "final action requires at least one file.",
        path: ["files"],
      });
    }
  });

export type AgentFastContextScoutPlannerDecision = z.infer<typeof ScoutPlannerDecisionSchema>;

export class AgentFastContextScoutPlannerValidationError extends Error {
  readonly invalidDecision: unknown;
  readonly issues: string[];

  constructor(invalidDecision: unknown, issues: string[]) {
    super(`FastContext Scout planner decision failed validation: ${issues.join("; ")}`);
    this.name = "AgentFastContextScoutPlannerValidationError";
    this.invalidDecision = invalidDecision;
    this.issues = issues;
  }
}

export function parseFastContextScoutPlannerDecision(
  decision: FastContextScoutPlannerDecision,
  input: AgentFastContextScoutPlannerPromptInput,
): AgentFastContextScoutPlannerDecision {
  const parsed = safeParseNormalizedBamlOutput(ScoutPlannerDecisionSchema, decision);
  if (!parsed.success) {
    throw new AgentFastContextScoutPlannerValidationError(
      parsed.normalized,
      parsed.issues,
    );
  }

  const allowed = new Set(input.allowedCommands.item.map((command) => command.type));
  const disallowed = parsed.data.commands
    .map((command) => command.type)
    .filter((type) => !allowed.has(type));
  if (disallowed.length > 0) {
    throw new AgentFastContextScoutPlannerValidationError(
      parsed.normalized,
      disallowed.map((type) => `commands.type: command type is not allowed: ${type}`),
    );
  }

  return parsed.data;
}
