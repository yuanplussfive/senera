import type { AgentLanguageModelRequest } from "./AgentLanguageModel.js";
import {
  projectOpenAiCompatibleTextMessages,
  type OpenAiCompatibleTextMessage,
} from "./OpenAiCompatibleMessageProjector.js";

export function buildOpenAiInput(
  request: AgentLanguageModelRequest,
  options: { supportsDeveloperRole?: boolean } = {},
): OpenAiCompatibleTextMessage[] {
  return projectOpenAiCompatibleTextMessages(request, {
    developerRole: options.supportsDeveloperRole === true ? "native" : "system",
  });
}
