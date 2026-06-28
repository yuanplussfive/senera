import { z } from "zod";
import { AgentActionPlannerValidationError } from "./ActionPlanner/AgentActionPlannerSchema.js";
import type {
  AgentPromptContractView,
} from "./Prompt/AgentPromptContractProjector.js";
import { safeParseNormalizedBamlOutput } from "./AgentBamlOutputNormalizer.js";
import { validateToolSignatureArguments } from "./ToolRuntime/AgentToolSignatureArgumentValidator.js";

export interface AgentPlannedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentParsedToolCallPlan {
  calls: AgentPlannedToolCall[];
}

const NonEmptyStringSchema = z.string().trim().min(1);
type JsonValue = string | number | boolean | JsonValue[] | JsonObject;

interface JsonObject {
  [key: string]: JsonValue;
}

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]));
const ToolCallArgumentsSchema = z.record(z.string(), JsonValueSchema);

const ToolCallPlanSchema = z
  .object({
    calls: z.array(z.object({
      name: NonEmptyStringSchema,
      arguments: ToolCallArgumentsSchema,
    }).strict()),
  })
  .strict();

export class AgentEmptyToolCallPlanError extends AgentActionPlannerValidationError {
  constructor(invalidDecision: unknown) {
    super([
      "calls: 工具调用计划为空，当前工具调用阶段需要至少一个可执行工具调用。",
    ], invalidDecision);
    this.name = "AgentEmptyToolCallPlanError";
  }
}

export function isAgentEmptyToolCallPlanError(error: unknown): error is AgentEmptyToolCallPlanError {
  return error instanceof AgentEmptyToolCallPlanError;
}

export function parseToolCallPlan(
  plan: unknown,
  options: {
    allowedTools: readonly string[];
    toolContracts?: readonly {
      name: string;
      argumentsContract?: AgentPromptContractView;
    }[];
  },
): AgentParsedToolCallPlan {
  const parsed = safeParseNormalizedBamlOutput(ToolCallPlanSchema, plan);
  const issues: string[] = [];
  if (!parsed.success) {
    issues.push(...parsed.issues);
    throw new AgentActionPlannerValidationError(issues, parsed.normalized);
  }

  if (parsed.data.calls.length === 0) {
    throw new AgentEmptyToolCallPlanError(parsed.normalized);
  }

  const allowed = new Set(options.allowedTools);
  const contracts = new Map(
    (options.toolContracts ?? []).map((tool) => [tool.name, tool.argumentsContract] as const),
  );
  const calls = parsed.data.calls.map((call, index) => {
    if (!allowed.has(call.name)) {
      issues.push(`calls.${index}.name: 工具不在 allowedTools 中：${call.name}`);
    }

    validateToolArguments(call.arguments, contracts.get(call.name), ["calls", index, "arguments"], issues);
    return {
      name: call.name,
      arguments: call.arguments,
    };
  });

  if (issues.length > 0) {
    throw new AgentActionPlannerValidationError(issues, parsed.normalized);
  }

  return {
    calls,
  };
}

function validateToolArguments(
  args: Record<string, unknown>,
  contract: AgentPromptContractView | undefined,
  path: Array<string | number>,
  issues: string[],
): void {
  if (!contract) {
    return;
  }

  issues.push(...validateToolSignatureArguments({
    contract,
    args,
    path,
  }));
}
