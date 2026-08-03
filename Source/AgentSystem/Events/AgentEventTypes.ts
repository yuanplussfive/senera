import type { AgentConfigDomainEvent } from "../Config/AgentConfigEventTypes.js";
import type { AgentApprovalDomainEvent } from "../Approvals/AgentApprovalEventTypes.js";
import type { AgentExecutionDomainEvent } from "./AgentExecutionEventTypes.js";
import type { AgentSandboxDomainEvent } from "../Sandbox/AgentSandboxEventTypes.js";
import type { AgentSessionDomainEvent } from "../Session/AgentSessionEventTypes.js";
import type { AgentToolDomainEvent } from "../ToolRuntime/AgentToolEventTypes.js";
import type { AgentInteractionInputDomainEvent } from "../Interaction/AgentInteractionInputEventTypes.js";
import type { AgentMcpSettingsDomainEvent } from "../McpPackages/AgentMcpSettingsEventTypes.js";

type AgentDomainEventPayload =
  | AgentSessionDomainEvent
  | AgentExecutionDomainEvent
  | AgentToolDomainEvent
  | AgentApprovalDomainEvent
  | AgentInteractionInputDomainEvent
  | AgentSandboxDomainEvent
  | AgentConfigDomainEvent
  | AgentMcpSettingsDomainEvent;

export type AgentDomainEvent = AgentDomainEventPayload & {
  readonly eventId?: string;
};

export type AgentEventSink = (event: AgentDomainEvent) => void | Promise<void>;
