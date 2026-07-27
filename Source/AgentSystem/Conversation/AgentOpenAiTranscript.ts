import { z } from "zod";

export interface AgentOpenAiFunctionToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export type AgentOpenAiTranscriptMessage =
  | {
      role: "system" | "developer" | "user";
      content: string;
    }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: AgentOpenAiFunctionToolCall[];
    }
  | {
      role: "tool";
      tool_call_id: string;
      content: string;
    };

const FunctionToolCallSchema = z
  .object({
    id: z.string().trim().min(1),
    type: z.literal("function"),
    function: z
      .object({
        name: z.string().trim().min(1),
        arguments: z.string(),
      })
      .strict(),
  })
  .strict();

const TextMessageSchema = z
  .object({
    role: z.enum(["system", "developer", "user"]),
    content: z.string(),
  })
  .strict();

const AssistantMessageSchema = z
  .object({
    role: z.literal("assistant"),
    content: z.string().nullable(),
    tool_calls: z.array(FunctionToolCallSchema).optional(),
  })
  .strict();

const ToolMessageSchema = z
  .object({
    role: z.literal("tool"),
    tool_call_id: z.string().trim().min(1),
    content: z.string(),
  })
  .strict();

export const AgentOpenAiTranscriptMessageSchema = z.union([
  TextMessageSchema,
  AssistantMessageSchema,
  ToolMessageSchema,
]);

export interface AgentOpenAiTranscriptParseFailure {
  issueCount: number;
  issues: string[];
}

const MaxReportedTranscriptIssues = 5;

// Invalid stored transcripts intentionally degrade to an empty history instead of
// crashing session loads, but the loss must be observable: callers pass onInvalid
// to surface the failure through their diagnostics channel.
export function parseAgentOpenAiTranscriptMessages(
  value: unknown,
  onInvalid?: (failure: AgentOpenAiTranscriptParseFailure) => void,
): AgentOpenAiTranscriptMessage[] {
  const parsed = z.array(AgentOpenAiTranscriptMessageSchema).safeParse(value);
  if (parsed.success) return parsed.data;
  onInvalid?.(projectTranscriptParseFailure(parsed.error));
  return [];
}

function projectTranscriptParseFailure(error: z.ZodError): AgentOpenAiTranscriptParseFailure {
  return {
    issueCount: error.issues.length,
    issues: error.issues
      .slice(0, MaxReportedTranscriptIssues)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
  };
}

export function stringifyOpenAiFunctionArguments(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value ?? {});
}
