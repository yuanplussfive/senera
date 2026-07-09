import { createOpaqueId, createToolCallId } from "../Core/AgentIds.js";
import type {
  AgentPiAssistantMessage,
  AgentPiAssistantToolCall,
} from "./AgentPiAssistantMessageTypes.js";
import type {
  PiOpenAiChatCompletionResponse,
  PiOpenAiChatCompletionChoiceMessage,
  PiOpenAiModelsResponse,
  PiOpenAiToolCall,
} from "./AgentPiOpenAiWireTypes.js";

export function projectPiModelsResponse(modelId: string): PiOpenAiModelsResponse {
  return {
    object: "list",
    data: [{
      id: modelId,
      object: "model",
      created: unixNow(),
      owned_by: "senera",
    }],
  };
}

export function projectPiChatCompletionResponse(
  model: string,
  message: AgentPiAssistantMessage,
): PiOpenAiChatCompletionResponse {
  return {
    id: createOpaqueId("chatcmpl"),
    object: "chat.completion",
    created: unixNow(),
    model,
    choices: [{
      index: 0,
      message: projectMessage(message),
      finish_reason: message.kind === "tool_calls" ? "tool_calls" : "stop",
    }],
  };
}

export function projectPiChatCompletionStreamEvents(
  model: string,
  message: AgentPiAssistantMessage,
): unknown[] {
  const id = createOpaqueId("chatcmpl");
  const created = unixNow();
  const base = {
    id,
    object: "chat.completion.chunk",
    created,
    model,
  };

  const roleEvent = {
    ...base,
    choices: [{
      index: 0,
      delta: { role: "assistant" },
      finish_reason: null,
    }],
  };

  if (message.kind === "tool_calls") {
    return [
      roleEvent,
      ...contentDeltaEvents(base, message.content),
      ...message.toolCalls.flatMap((call, index) => toolCallDeltaEvents(base, call, index)),
      {
        ...base,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: "tool_calls",
        }],
      },
    ];
  }

  return [
    roleEvent,
    {
      ...base,
      choices: [{
        index: 0,
        delta: { content: message.content },
        finish_reason: null,
      }],
    },
    {
      ...base,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: "stop",
      }],
    },
  ];
}

function projectMessage(message: AgentPiAssistantMessage): PiOpenAiChatCompletionChoiceMessage {
  if (message.kind === "tool_calls") {
    return {
      role: "assistant",
      content: message.content.trim() ? message.content : null,
      tool_calls: message.toolCalls.map(projectToolCall),
    };
  }

  return {
    role: "assistant",
    content: message.content,
  };
}

function projectToolCall(call: AgentPiAssistantToolCall): PiOpenAiToolCall {
  return {
    id: call.id ?? createToolCallId(),
    type: "function",
    function: {
      name: call.name,
      arguments: JSON.stringify(call.arguments),
    },
  };
}

function contentDeltaEvents(
  base: Record<string, unknown>,
  content: string,
): unknown[] {
  return content.trim()
    ? [{
        ...base,
        choices: [{
          index: 0,
          delta: { content },
          finish_reason: null,
        }],
      }]
    : [];
}

function toolCallDeltaEvents(
  base: Record<string, unknown>,
  call: AgentPiAssistantToolCall,
  index: number,
): unknown[] {
  const projected = projectToolCall(call);
  return [
    {
      ...base,
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index,
            id: projected.id,
            type: "function",
            function: {
              name: projected.function.name,
              arguments: "",
            },
          }],
        },
        finish_reason: null,
      }],
    },
    {
      ...base,
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index,
            function: {
              arguments: projected.function.arguments,
            },
          }],
        },
        finish_reason: null,
      }],
    },
  ];
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}
