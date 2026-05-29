import type { AgentLanguageModelRequest } from "../AgentLanguageModel.js";

export function buildOpenAiInput(
  request: AgentLanguageModelRequest,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  return [
    {
      role: "system",
      content: request.systemPrompt,
    },
    ...request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];
}
