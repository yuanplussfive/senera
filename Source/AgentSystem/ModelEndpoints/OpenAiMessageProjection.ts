import type { AgentLanguageModelRequest } from "./AgentLanguageModel.js";
import { projectOpenAiCompatibleMessages, type OpenAiCompatibleMessage } from "./OpenAiCompatibleMessageProjector.js";

export function buildOpenAiInput(
  request: AgentLanguageModelRequest,
  options: { supportsDeveloperRole?: boolean } = {},
): OpenAiCompatibleMessage[] {
  return projectOpenAiCompatibleMessages(request, {
    developerRole: options.supportsDeveloperRole === true ? "native" : "system",
  });
}

export function buildOpenAiResponsesInput(
  request: AgentLanguageModelRequest,
  options: { supportsDeveloperRole?: boolean } = {},
): Array<{ role: "system" | "developer" | "user" | "assistant"; content: unknown }> {
  return buildOpenAiInput(request, options).map((message) => ({
    ...message,
    content: Array.isArray(message.content)
      ? message.content.map((part) =>
          part.type === "text"
            ? { type: "input_text", text: part.text }
            : { type: "input_image", image_url: part.image_url.url },
        )
      : message.content,
  }));
}
