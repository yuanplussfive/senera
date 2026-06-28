import type { AgentSourceDiagnostic } from "../Diagnostics/AgentSourceDiagnostic.js";
import type { AgentProtocolErrorCode } from "../Xml/AgentXmlStatus.js";

export interface AgentDecisionErrorSpec {
  code: AgentProtocolErrorCode;
  message: string;
  diagnostics?: AgentSourceDiagnostic[];
  heading?: string;
  details?: Record<string, unknown>;
}
