import type { AgentConfigDomainEvent } from "../Config/AgentConfigEventTypes.js";
import type { AgentApprovalDomainEvent } from "../Approvals/AgentApprovalEventTypes.js";
import type { AgentExecutionDomainEvent } from "./AgentExecutionEventTypes.js";
import type { AgentSandboxDomainEvent } from "../Sandbox/AgentSandboxEventTypes.js";
import type { AgentSessionDomainEvent } from "../Session/AgentSessionEventTypes.js";
import type { AgentToolDomainEvent } from "../ToolRuntime/AgentToolEventTypes.js";
import type { AgentInteractionInputDomainEvent } from "../Interaction/AgentInteractionInputEventTypes.js";
import type { AgentFeedbackDomainEvent } from "../Interaction/AgentFeedbackEventTypes.js";
import type { AgentMcpSettingsDomainEvent } from "../McpPackages/AgentMcpSettingsEventTypes.js";
import type { AgentOrchestrationDomainEvent } from "../Orchestration/AgentOrchestrationEventTypes.js";
import type { AgentExecutionLedgerDomainEvent } from "../Goals/AgentExecutionEventTypes.js";
import type { AgentTodoDomainEvent } from "../Todos/AgentTodoEventTypes.js";
import type { AgentChannelDomainEvent } from "../Channels/AgentChannelEventTypes.js";
import type { AgentRuntimeDependencySnapshot } from "../Runtime/AgentRuntimeDependencyTypes.js";
import type { AgentEventKinds } from "./AgentEventCatalog.js";

type AgentDomainEventPayload =
  | AgentSessionDomainEvent
  | AgentExecutionDomainEvent
  | AgentToolDomainEvent
  | AgentApprovalDomainEvent
  | AgentInteractionInputDomainEvent
  | AgentFeedbackDomainEvent
  | AgentSandboxDomainEvent
  | AgentConfigDomainEvent
  | AgentMcpSettingsDomainEvent
  | AgentOrchestrationDomainEvent
  | AgentExecutionLedgerDomainEvent
  | AgentTodoDomainEvent
  | AgentChannelDomainEvent
  | {
      kind: typeof AgentEventKinds.RuntimeDependencySnapshot;
      context: Record<string, never>;
      data: {
        readonly dependencies: readonly AgentRuntimeDependencySnapshot[];
        readonly complete?: boolean;
      };
    };

export type AgentDomainEvent = AgentDomainEventPayload & {
  readonly eventId?: string;
};

export type AgentEventSink = (event: AgentDomainEvent) => void | Promise<void>;
