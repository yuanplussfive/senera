import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { AgentExecutionApprovalMode } from "../Safety/AgentExecutionApprovalMode.js";
import type { AgentPinnedSkillReference } from "../Skills/AgentSkillActivation.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { AgentExtensionRegistryLike } from "../Types/ToolRuntimeTypes.js";
import type {
  AgentChildRunMessage,
  AgentChildRunRecord,
  AgentChildRunRepository,
  AgentChildWorkspaceAccessMode,
} from "./AgentChildRunTypes.js";
import type { AgentOrchestrationEventRelay } from "./AgentOrchestrationEventRelay.js";
import type { AgentRunContextMode, AgentRunDispatchPort } from "./AgentRunDispatchPort.js";
import type { AgentSubagentPreflightPort } from "./AgentSubagentPreflight.js";
import type { AgentSubagentRoleCatalogPort } from "./AgentSubagentRoleCatalog.js";

export const AgentDelegationExecutionModes = {
  Wait: "wait",
  Detach: "detach",
} as const;

export type AgentDelegationExecutionMode =
  (typeof AgentDelegationExecutionModes)[keyof typeof AgentDelegationExecutionModes];

export interface AgentSpawnRequest {
  readonly task: string;
  readonly agent?: string;
  readonly forkContext?: boolean;
}

export interface AgentDelegationRequest {
  readonly agent: string;
  readonly task: string;
  /** Optional v2 graph identity. The host generates both values when omitted. */
  readonly ownerRunId?: string;
  readonly nodeId?: string;
  readonly workspaceAccess: AgentChildWorkspaceAccessMode;
  readonly context?: AgentRunContextMode;
  readonly executionMode: AgentDelegationExecutionMode;
  readonly modelProviderId?: string;
  readonly skills?: readonly string[];
  readonly thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}

export interface AgentDelegationContext {
  readonly parentSessionId: string;
  readonly parentRequestId: string;
  readonly parentModelProviderId?: string;
  readonly parentThinkingLevel?: ModelThinkingLevel;
  readonly approvalMode: AgentExecutionApprovalMode;
  readonly authorizedToolNames: readonly string[];
  readonly activeSkills?: readonly AgentPinnedSkillReference[];
  readonly registry: AgentExtensionRegistryLike;
  readonly onEvent?: AgentEventSink;
  readonly signal?: AbortSignal;
}

export interface AgentDelegationServiceOptions {
  readonly workspaceRoot: string;
  readonly configuration: () => {
    readonly config: AgentSystemConfig;
    readonly revision?: number;
  };
  readonly repository: AgentChildRunRepository;
  readonly dispatcher: AgentRunDispatchPort;
  readonly events: AgentOrchestrationEventRelay;
  /** Receives terminal detached runs without coupling execution to delivery. */
  readonly completion?: AgentDelegationCompletionPort;
  readonly preflight?: AgentSubagentPreflightPort;
  readonly roleCatalog?: AgentSubagentRoleCatalogPort;
}

/**
 * Completion boundary for adapters, sessions, and other host consumers.
 * Implementations must make delivery idempotent; the same run may be replayed
 * after a process restart while its result is being recovered.
 */
export interface AgentDelegationCompletionPort {
  /** Stable deployment-level identity used for durable delivery records. */
  readonly id: string;
  completed(record: AgentChildRunRecord): Promise<void>;
}

/** Late-bound fan-out used while ServerRuntime wires its services and channels. */
export class AgentDelegationCompletionGateway implements AgentDelegationCompletionPort {
  readonly id = "senera.completion-gateway";
  private readonly delegates = new Set<AgentDelegationCompletionPort>();

  bind(delegate: AgentDelegationCompletionPort): () => void {
    if (!delegate.id.trim()) throw new Error("Completion port id must be a non-empty string.");
    if ([...this.delegates].some((candidate) => candidate.id === delegate.id)) {
      throw new Error(`Completion port is already bound: ${delegate.id}`);
    }
    this.delegates.add(delegate);
    return () => {
      this.delegates.delete(delegate);
    };
  }

  completed(record: AgentChildRunRecord): Promise<void> {
    const delegates = [...this.delegates];
    if (delegates.length === 0) return Promise.resolve();

    // A channel adapter must not prevent another adapter from receiving the
    // same durable completion. Each sink owns its own retry/idempotency policy.
    return Promise.allSettled(delegates.map((delegate) => delegate.completed(record))).then(() => undefined);
  }
}

export interface AgentSupervisorContactRequest {
  readonly reason: "need_decision" | "progress_update";
  readonly message: string;
}

export interface AgentSupervisorContactResult {
  readonly run: AgentChildRunRecord;
  readonly message: AgentChildRunMessage;
}

export interface AgentChildRunWaitResult {
  readonly runs: readonly (AgentChildRunRecord | undefined)[];
  readonly timedOut: boolean;
}

export interface AgentChildRunInputSubmission {
  readonly run: AgentChildRunRecord;
  readonly message: AgentChildRunMessage;
}
