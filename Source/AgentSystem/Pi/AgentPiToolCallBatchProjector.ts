import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import { createAssistantMessageId, createToolBatchId } from "../Core/AgentIds.js";
import { AgentEventKinds, emitAgentEvent } from "../Events/AgentEvent.js";
import type { AgentPiMutableSessionFrame } from "./AgentPiCodingAgentSessionFrame.js";
import type { AgentPiToolCallPreflightInput } from "./AgentPiToolCallPreflight.js";

export interface AgentPiToolCallProjection extends AgentPiToolCallPreflightInput {
  readonly id: string;
}

export async function registerAgentPiToolCallBatch(
  frame: AgentPiMutableSessionFrame,
  message: AssistantMessage,
): Promise<void> {
  const toolCalls = projectToolCalls(message);
  if (toolCalls.length === 0) return;
  const snapshot = frame.snapshot();
  if (!snapshot.turnState) throw new Error("Pi tool calls require an active turn state.");
  const callIds = toolCalls.map((call) => requireToolCallId(call.id));
  const batchId = createToolBatchId();
  snapshot.turnState.registerToolBatch(batchId, toolCalls, projectFixedBatchPayload(message, toolCalls));
  const context = {
    sessionId: snapshot.sessionId,
    requestId: snapshot.requestId ?? snapshot.turnState.context.requestId,
    step: snapshot.step ?? snapshot.turnState.context.step,
  };
  const trimmedContent = message.content
    .flatMap((entry) => (entry.type === "text" ? [entry.text] : []))
    .join("")
    .trim();
  if (trimmedContent) {
    await emitAgentEvent(snapshot.onEvent, {
      kind: AgentEventKinds.AssistantMessageCreated,
      context,
      data: {
        messageId: createAssistantMessageId(),
        kind: "tool_preface",
        content: trimmedContent,
        terminal: false,
        toolCount: toolCalls.length,
        batchId,
        toolCallIds: callIds,
      },
    });
  }
  await emitAgentEvent(snapshot.onEvent, {
    kind: AgentEventKinds.ToolCallsPlanned,
    context,
    data: {
      toolCount: toolCalls.length,
      tools: toolCalls.map((call) => call.toolName),
      calls: toolCalls.map((call) => ({ callId: call.toolCallId, toolName: call.toolName })),
      status: "planned",
      executionMode: "parallel",
      batchId,
      reason: trimmedContent || undefined,
    },
  });
}

function projectToolCalls(message: AssistantMessage): AgentPiToolCallProjection[] {
  return message.content.flatMap((entry) =>
    entry.type === "toolCall"
      ? [
          {
            id: requireToolCallId(entry.id),
            toolCallId: requireToolCallId(entry.id),
            toolName: entry.name,
            input: entry.arguments,
          },
        ]
      : [],
  );
}

function projectFixedBatchPayload(
  assistant: AssistantMessage,
  toolCalls: readonly AgentPiToolCallProjection[],
): unknown {
  return {
    assistant,
    toolResults: toolCalls.map(
      (call) =>
        ({
          role: "toolResult",
          toolCallId: call.id,
          toolName: call.toolName,
          content: [{ type: "text", text: "" }],
          isError: false,
          timestamp: assistant.timestamp,
        }) satisfies ToolResultMessage,
    ),
  };
}

function requireToolCallId(value: string): string {
  if (value.trim()) return value;
  throw new Error("Pi provider returned a tool call without an id.");
}
