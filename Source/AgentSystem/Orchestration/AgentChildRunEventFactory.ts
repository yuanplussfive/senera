import { AgentEventKinds, type AgentDomainEvent } from "../Events/AgentEvent.js";
import type { AgentChildRunMessage, AgentChildRunRecord } from "./AgentChildRunTypes.js";

export type AgentChildRunLifecycleEventKind =
  | typeof AgentEventKinds.ChildRunQueued
  | typeof AgentEventKinds.ChildRunStarted
  | typeof AgentEventKinds.ChildRunAwaitingSupervisor
  | typeof AgentEventKinds.ChildRunResumed
  | typeof AgentEventKinds.ChildRunCompleted
  | typeof AgentEventKinds.ChildRunPartialCompleted
  | typeof AgentEventKinds.ChildRunInterrupted
  | typeof AgentEventKinds.ChildRunTimedOut
  | typeof AgentEventKinds.ChildRunFailed
  | typeof AgentEventKinds.ChildRunCancelled;

export type AgentChildRunCancellationReason = "parent_cancelled" | "deadline_exhausted" | "shutdown";

export function createAgentChildRunLifecycleEvent(
  kind: AgentChildRunLifecycleEventKind,
  record: AgentChildRunRecord,
): AgentDomainEvent {
  return {
    kind,
    context: createAgentChildRunEventContext(record),
    data: {
      ...createAgentChildRunEventIdentity(record),
      contextMode: record.contextMode,
      ...(record.modelProviderId ? { modelProviderId: record.modelProviderId } : {}),
      ...(record.modelSelectionSource ? { modelSelectionSource: record.modelSelectionSource } : {}),
      ...(record.selectedSkills.length > 0 ? { selectedSkills: record.selectedSkills } : {}),
      ...(record.error ? { error: record.error } : {}),
    },
  };
}

export function createAgentChildRunSnapshotEvent(record: AgentChildRunRecord): AgentDomainEvent {
  if (!record.snapshot) throw new Error(`Child run ${record.id} has no snapshot to publish.`);
  return {
    kind: AgentEventKinds.ChildRunSnapshotUpdated,
    context: createAgentChildRunEventContext(record),
    data: {
      ...createAgentChildRunEventIdentity(record),
      snapshot: record.snapshot,
      checkpointAvailable: record.checkpoint !== undefined,
    },
  };
}

export function createAgentChildRunDeadlineExtendedEvent(
  record: AgentChildRunRecord,
  extension: { readonly extensionMs: number; readonly grantedExtensionMs: number; readonly softDeadlineAt: string },
): AgentDomainEvent {
  return {
    kind: AgentEventKinds.ChildRunDeadlineExtended,
    context: createAgentChildRunEventContext(record),
    data: { ...createAgentChildRunEventIdentity(record), ...extension },
  };
}

export function createAgentChildRunWrappingUpEvent(
  record: AgentChildRunRecord,
  hardDeadlineAt: string,
): AgentDomainEvent {
  return {
    kind: AgentEventKinds.ChildRunWrappingUp,
    context: createAgentChildRunEventContext(record),
    data: { ...createAgentChildRunEventIdentity(record), hardDeadlineAt },
  };
}

export function createAgentChildRunCancellingEvent(
  record: AgentChildRunRecord,
  reason: AgentChildRunCancellationReason,
): AgentDomainEvent {
  return {
    kind: AgentEventKinds.ChildRunCancelling,
    context: createAgentChildRunEventContext(record),
    data: { ...createAgentChildRunEventIdentity(record), reason },
  };
}

export function createAgentChildRunMessageEvent(
  record: AgentChildRunRecord,
  message: AgentChildRunMessage,
): AgentDomainEvent {
  return {
    kind: AgentEventKinds.ChildRunMessageCreated,
    context: createAgentChildRunEventContext(record),
    data: {
      ...createAgentChildRunEventIdentity(record),
      messageId: message.id,
      direction: message.direction,
      messageKind: message.kind,
      content: message.content,
    },
  };
}

export function createAgentChildRunScope(record: AgentChildRunRecord) {
  return {
    parentSessionId: record.parentSessionId,
    parentRequestId: record.parentRequestId,
    childRunId: record.id,
    agentName: record.agentName,
    role: "childAgent" as const,
  };
}

function createAgentChildRunEventContext(record: AgentChildRunRecord) {
  return {
    sessionId: record.parentSessionId,
    requestId: record.parentRequestId,
    scope: createAgentChildRunScope(record),
  };
}

function createAgentChildRunEventIdentity(record: AgentChildRunRecord) {
  return {
    childRunId: record.id,
    ownerRunId: record.ownerRunId,
    nodeId: record.nodeId,
    childSessionId: record.childSessionId,
    agentName: record.agentName,
    status: record.status,
  };
}
