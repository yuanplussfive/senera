import type { AgentConfigDomainEvent } from "../Config/AgentConfigEventTypes.js";
import type { AgentApprovalDomainEvent } from "../Approvals/AgentApprovalEventTypes.js";
import type { AgentExecutionDomainEvent } from "./AgentExecutionEventTypes.js";
import type { AgentSandboxDomainEvent } from "../Sandbox/AgentSandboxEventTypes.js";
import type { AgentSessionDomainEvent } from "../Session/AgentSessionEventTypes.js";
import type { AgentToolDomainEvent } from "../ToolRuntime/AgentToolEventTypes.js";
import type { AgentInteractionInputDomainEvent } from "../Interaction/AgentInteractionInputEventTypes.js";
import type { AgentMcpSettingsDomainEvent } from "../McpPackages/AgentMcpSettingsEventTypes.js";
import type { AgentOrchestrationDomainEvent } from "../Orchestration/AgentOrchestrationEventTypes.js";
import type { AgentContinuityDomainEvent } from "../Continuity/AgentContinuityEventTypes.js";
import type { AgentExecutionLedgerDomainEvent } from "../Goals/AgentExecutionEventTypes.js";
import type { AgentTodoDomainEvent } from "../Todos/AgentTodoEventTypes.js";
import type { AgentAgendaDomainEvent } from "../Agenda/AgentAgendaEventTypes.js";
import type { AgentWorldDomainEvent } from "../World/AgentWorldEventTypes.js";
import type { AgentChannelDomainEvent } from "../Channels/AgentChannelEventTypes.js";

type AgentDomainEventPayload =
  | AgentSessionDomainEvent
  | AgentExecutionDomainEvent
  | AgentToolDomainEvent
  | AgentApprovalDomainEvent
  | AgentInteractionInputDomainEvent
  | AgentSandboxDomainEvent
  | AgentConfigDomainEvent
  | AgentMcpSettingsDomainEvent
  | AgentOrchestrationDomainEvent
  | AgentContinuityDomainEvent
  | AgentExecutionLedgerDomainEvent
  | AgentTodoDomainEvent
  | AgentAgendaDomainEvent
  | AgentWorldDomainEvent
  | AgentChannelDomainEvent;

export type AgentDomainEvent = AgentDomainEventPayload & {
  readonly eventId?: string;
};

export type AgentEventSink = (event: AgentDomainEvent) => void | Promise<void>;
