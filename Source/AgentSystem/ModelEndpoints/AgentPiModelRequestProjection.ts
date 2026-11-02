import type { AssistantMessage, Context, Message } from "@earendil-works/pi-ai";
import type { AgentLanguageModelMessage, AgentLanguageModelImageAttachment } from "./AgentLanguageModel.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import { AgentNativeToolApiByEndpoint } from "./AgentModelEndpointContract.js";

export function projectAgentPiModelRequestContext(
  request: { readonly systemPrompt: string; readonly messages: readonly AgentLanguageModelMessage[] },
  configuration: ResolvedAgentModelProviderConfig,
): Context {
  const systems = [request.systemPrompt, ...request.messages.filter(isSystem).map((message) => message.content)].filter(
    (text) => text.trim().length > 0,
  );
  const messages: Message[] = request.messages
    .filter((message) => !isSystem(message))
    .map((message) => {
      if (message.role === "user")
        return {
          role: "user",
          timestamp: Date.now(),
          content: message.attachments?.length
            ? [
                { type: "text", text: message.content },
                ...message.attachments.map((image) => ({
                  type: "image" as const,
                  data: image.data,
                  mimeType: image.mimeType,
                })),
              ]
            : message.content,
        };
      if (message.role === "assistant")
        return {
          role: "assistant",
          api: AgentNativeToolApiByEndpoint[configuration.Endpoint],
          provider: configuration.ProviderId,
          model: configuration.Model,
          content: [{ type: "text", text: message.content }],
          timestamp: Date.now(),
          stopReason: "stop",
          usage: emptyHistoricalUsage(),
        };
      throw new Error(`Unsupported model request role: ${message.role}.`);
    });
  if (messages.length === 0) throw new Error("A Pi request requires at least one model message.");
  return { systemPrompt: systems.join("\n\n"), messages };
}

function isSystem(message: AgentLanguageModelMessage) {
  return message.role === "system" || message.role === "developer";
}

export function attachAgentModelRequestImages(
  messages: readonly AgentLanguageModelMessage[],
  images?: readonly AgentLanguageModelImageAttachment[],
): readonly AgentLanguageModelMessage[] {
  if (!images?.length) return messages;
  const lastUser = messages.reduce((last, message, index) => (message.role === "user" ? index : last), -1);
  if (lastUser < 0) throw new Error("Image attachments require a user message.");
  return messages.map((message, index) =>
    index === lastUser ? { ...message, attachments: [...(message.attachments ?? []), ...images] } : message,
  );
}
function emptyHistoricalUsage(): AssistantMessage["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}
