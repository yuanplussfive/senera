import type { AgentDomainEvent } from "../Events/AgentEvent.js";
import { AgentChildRunMessageDirections, type AgentChildRunRecord } from "./AgentChildRunTypes.js";
import type { AgentChildRunInputSubmission } from "./AgentDelegationRuntimeContracts.js";

export function latestParentMessage(run: AgentChildRunRecord): AgentChildRunInputSubmission["message"] | undefined {
  return [...run.messages]
    .reverse()
    .find((message) => message.direction === AgentChildRunMessageDirections.ParentToChild);
}

export function readChildRunId(event: AgentDomainEvent): string | undefined {
  const data = event.data;
  if (data && typeof data === "object" && "childRunId" in data && typeof data.childRunId === "string") {
    return data.childRunId;
  }
  return (event.context as { readonly scope?: { readonly childRunId?: string } }).scope?.childRunId;
}
