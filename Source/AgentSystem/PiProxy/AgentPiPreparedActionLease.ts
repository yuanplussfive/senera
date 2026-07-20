import type { ParsedPiControllerAction } from "./AgentPiAssistantMessageSchema.js";

export interface AgentPiPreparedActionLeasePort {
  take(): ParsedPiControllerAction | undefined;
}

export class AgentPiPreparedActionLease implements AgentPiPreparedActionLeasePort {
  private action: ParsedPiControllerAction | undefined;

  constructor(action: ParsedPiControllerAction | undefined) {
    this.action = action ? structuredClone(action) : undefined;
  }

  take(): ParsedPiControllerAction | undefined {
    const action = this.action;
    this.action = undefined;
    return action ? structuredClone(action) : undefined;
  }
}
