import type { AgentProtocolErrorCode } from "./Xml/AgentXmlStatus.js";

export interface AgentRetryInstruction {
  retryable: boolean;
  code: AgentProtocolErrorCode;
  message: string;
  diagnostics?: unknown[];
  repairPrompt?: string;
  details?: unknown;
}

export class AgentRetryableError extends Error {
  constructor(readonly instruction: AgentRetryInstruction) {
    super(instruction.message);
  }
}
