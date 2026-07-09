import type { AgentConfigDomainEvent } from "../Config/AgentConfigEventTypes.js";
import type { AgentApprovalDomainEvent } from "../Approvals/AgentApprovalEventTypes.js";
import type { AgentExecutionDomainEvent } from "./AgentExecutionEventTypes.js";
import type { AgentSandboxDomainEvent } from "../Sandbox/AgentSandboxEventTypes.js";
import type { AgentSessionDomainEvent } from "../Session/AgentSessionEventTypes.js";
import type { AgentToolDomainEvent } from "../ToolRuntime/AgentToolEventTypes.js";

export type AgentDomainEvent =
  | AgentSessionDomainEvent
  | AgentExecutionDomainEvent
  | AgentToolDomainEvent
  | AgentApprovalDomainEvent
  | AgentSandboxDomainEvent
  | AgentConfigDomainEvent;

export type AgentEventSink = (event: AgentDomainEvent) => void | Promise<void>;
