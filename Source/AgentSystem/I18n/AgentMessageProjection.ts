import { errorMessage } from "../Core/AgentErrors.js";
import { AgentLocalizedError } from "./AgentLocalizedError.js";
import {
  AgentDefaultLocale,
  agentErrorMessage,
  projectAgentLocalizedMessage,
  type AgentErrorMessageKey,
  type AgentLocalizedMessage,
  type AgentMessageParams,
} from "./AgentMessageCatalog.js";

export interface AgentProjectedMessage {
  readonly message: string;
  readonly localizedMessage: AgentLocalizedMessage;
}

export function projectAgentMessage(key: AgentErrorMessageKey, params: AgentMessageParams = {}): AgentProjectedMessage {
  const localizedMessage = projectAgentLocalizedMessage(key, params);
  return {
    message: localizedMessage.text[AgentDefaultLocale],
    localizedMessage,
  };
}

export function projectAgentErrorMessage(
  error: unknown,
  fallbackKey: AgentErrorMessageKey,
  fallbackParams: AgentMessageParams = {},
): AgentProjectedMessage {
  const localizedError = findAgentLocalizedError(error);
  return {
    message: errorMessage(error) || agentErrorMessage(fallbackKey, fallbackParams),
    localizedMessage: localizedError
      ? projectAgentLocalizedMessage(localizedError.messageKey, localizedError.messageParams)
      : projectAgentLocalizedMessage(fallbackKey, fallbackParams),
  };
}

function findAgentLocalizedError(error: unknown): AgentLocalizedError | undefined {
  const visited = new Set<unknown>();
  let current = error;
  while (current instanceof Error && !visited.has(current)) {
    if (current instanceof AgentLocalizedError) return current;
    visited.add(current);
    current = current.cause;
  }
  return undefined;
}
