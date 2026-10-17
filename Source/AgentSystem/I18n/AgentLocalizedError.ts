import { AgentBaseError } from "../Core/AgentBaseError.js";
import {
  agentErrorMessage,
  normalizeAgentMessageParams,
  type AgentErrorMessageKey,
  type AgentLocalizedMessageParams,
  type AgentMessageParams,
} from "./AgentMessageCatalog.js";

export class AgentLocalizedError extends AgentBaseError {
  readonly messageKey: AgentErrorMessageKey;
  readonly messageParams: AgentLocalizedMessageParams;

  constructor(messageKey: AgentErrorMessageKey, messageParams: AgentMessageParams = {}, options?: ErrorOptions) {
    const normalizedParams = normalizeAgentMessageParams(messageParams);
    super(agentErrorMessage(messageKey, normalizedParams), options);
    this.messageKey = messageKey;
    this.messageParams = normalizedParams;
  }
}
