import type { AssistantMessage } from "@earendil-works/pi-ai";
import { AgentInvalidModelToolArgumentsError, AgentRequiredModelToolCallError } from "./AgentModelFailureMapper.js";

/** Returns true only for failures that indicate the structured contract was not met. */
export function isAgentNativeToolContractFailure(error: unknown): boolean {
  if (findError(error, (value) => value instanceof AgentRequiredModelToolCallError)) return true;
  if (findError(error, (value) => value instanceof AgentInvalidModelToolArgumentsError)) return true;

  return false;
}

/** Creates a short, data-free repair instruction so provider diagnostics cannot become prompt instructions. */
export function buildAgentNativeToolRepairPrompt(toolName: string, error: unknown): string {
  if (!isAgentNativeToolContractFailure(error)) throw error;
  const reason = findError(error, (value) => value instanceof AgentRequiredModelToolCallError)
    ? "The previous response did not contain exactly one call to the requested tool."
    : "The previous tool call arguments did not satisfy the published schema.";
  return [
    "Structured tool repair: the previous attempt did not satisfy the published contract.",
    reason,
    `Call exactly one available tool named ${JSON.stringify(toolName)} now.`,
    "Use only arguments allowed by its schema and return no prose or markdown outside the tool call.",
  ].join(" ");
}

/** Extracts exactly one native tool call without committing or executing it. */
export function extractAgentNativeToolArguments(message: AssistantMessage, toolName: string): Record<string, unknown> {
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    throw new Error(message.errorMessage ?? `Required ${toolName} request did not complete.`);
  }
  const calls = message.content.filter(
    (block): block is Extract<AssistantMessage["content"][number], { type: "toolCall" }> => block.type === "toolCall",
  );
  if (calls.length !== 1 || calls[0]?.name !== toolName) {
    throw new AgentRequiredModelToolCallError(
      toolName,
      calls.map((call) => call.name),
    );
  }
  const argumentsValue = calls[0].arguments;
  if (!argumentsValue || typeof argumentsValue !== "object" || Array.isArray(argumentsValue)) {
    throw new AgentInvalidModelToolArgumentsError(toolName);
  }
  return argumentsValue;
}

function findError<T extends Error>(error: unknown, predicate: (value: Error) => value is T): T | undefined {
  for (const current of iterateErrors(error)) {
    if (predicate(current)) return current;
  }
  return undefined;
}

function* iterateErrors(error: unknown): Iterable<Error> {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!(current instanceof Error) || seen.has(current)) continue;
    seen.add(current);
    yield current;
    pending.push(current.cause, Reflect.get(current, "originalError"));
  }
}
