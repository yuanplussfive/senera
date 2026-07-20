import { createOpaqueId, createToolCallId } from "../Core/AgentIds.js";
import type { AgentPiAssistantMessage, AgentPiAssistantToolCall } from "./AgentPiAssistantMessageTypes.js";
import type {
  PiOpenAiChatCompletionResponse,
  PiOpenAiChatCompletionChoiceMessage,
  PiOpenAiModelsResponse,
  PiOpenAiToolCall,
  PiOpenAiUsage,
} from "./AgentPiOpenAiWireTypes.js";
import type { AgentModelUsageValue } from "../ModelEndpoints/AgentModelUsage.js";

export function projectPiModelsResponse(modelId: string): PiOpenAiModelsResponse {
  return {
    object: "list",
    data: [
      {
        id: modelId,
        object: "model",
        created: unixNow(),
        owned_by: "senera",
      },
    ],
  };
}

export function projectPiChatCompletionResponse(
  model: string,
  message: AgentPiAssistantMessage,
  usage?: AgentModelUsageValue,
): PiOpenAiChatCompletionResponse {
  return {
    id: createOpaqueId("chatcmpl"),
    object: "chat.completion",
    created: unixNow(),
    model,
    choices: [
      {
        index: 0,
        message: projectMessage(message),
        finish_reason: message.kind === "tool_calls" ? "tool_calls" : "stop",
      },
    ],
    usage: projectPiOpenAiUsage(usage),
  };
}

export function projectPiChatCompletionStreamEvents(model: string, message: AgentPiAssistantMessage): unknown[] {
  return new AgentPiChatCompletionStreamProjector(model).messageEvents(message);
}

export class AgentPiChatCompletionStreamProjector {
  private readonly base: Record<string, unknown>;

  constructor(model: string) {
    this.base = {
      id: createOpaqueId("chatcmpl"),
      object: "chat.completion.chunk",
      created: unixNow(),
      model,
    };
  }

  roleEvent(): unknown {
    return this.chunk({ role: "assistant" }, null);
  }

  textDeltaEvent(content: string): unknown {
    return this.chunk({ content }, null);
  }

  finishEvent(reason: "stop" | "tool_calls"): unknown {
    return this.chunk({}, reason);
  }

  usageEvent(usage: AgentModelUsageValue | undefined): unknown | undefined {
    const projected = projectPiOpenAiUsage(usage);
    return projected
      ? {
          ...this.base,
          choices: [],
          usage: projected,
        }
      : undefined;
  }

  messageEvents(message: AgentPiAssistantMessage): unknown[] {
    const roleEvent = this.roleEvent();

    if (message.kind === "tool_calls") {
      return [
        roleEvent,
        ...contentDeltaEvents(this.base, message.content),
        ...message.toolCalls.flatMap((call, index) => toolCallDeltaEvents(this.base, call, index)),
        this.finishEvent("tool_calls"),
      ];
    }

    return [roleEvent, this.textDeltaEvent(message.content), this.finishEvent("stop")];
  }

  private chunk(delta: Record<string, unknown>, finishReason: "stop" | "tool_calls" | null): unknown {
    return {
      ...this.base,
      choices: [
        {
          index: 0,
          delta,
          finish_reason: finishReason,
        },
      ],
    };
  }
}

export function projectPiOpenAiUsage(usage: AgentModelUsageValue | undefined): PiOpenAiUsage | undefined {
  if (!usage) return undefined;
  const promptTokens = (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
  const completionTokens = usage.outputTokens ?? 0;
  const totalTokens = Math.max(usage.totalTokens ?? 0, promptTokens + completionTokens);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    prompt_tokens_details:
      usage.cacheReadTokens !== undefined || usage.cacheWriteTokens !== undefined
        ? {
            cached_tokens: usage.cacheReadTokens,
            cache_write_tokens: usage.cacheWriteTokens,
          }
        : undefined,
    completion_tokens_details:
      usage.reasoningTokens === undefined ? undefined : { reasoning_tokens: usage.reasoningTokens },
  };
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

function contentDeltaEvents(base: Record<string, unknown>, content: string): unknown[] {
  return content.trim()
    ? [
        {
          ...base,
          choices: [
            {
              index: 0,
              delta: { content },
              finish_reason: null,
            },
          ],
        },
      ]
    : [];
}

function toolCallDeltaEvents(base: Record<string, unknown>, call: AgentPiAssistantToolCall, index: number): unknown[] {
  const projected = projectToolCall(call);
  return [
    {
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index,
                id: projected.id,
                type: "function",
                function: {
                  name: projected.function.name,
                  arguments: "",
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    {
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index,
                function: {
                  arguments: projected.function.arguments,
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    },
  ];
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}
