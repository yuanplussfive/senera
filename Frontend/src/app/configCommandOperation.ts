import { EventKinds, type EventEnvelope } from "../api/eventTypes";
import { isUnknownRecord as isRecord } from "../lib/unknownValue";

export interface ConfigCommandEventOperation {
  commandId: string;
  kind: string;
}

export function readConfigCommandEventOperation(event: EventEnvelope): ConfigCommandEventOperation | undefined {
  if (event.kind !== EventKinds.ConfigSnapshot && event.kind !== EventKinds.ConfigFailed) return undefined;
  if (!isRecord(event.data)) return undefined;
  const operation = event.data.operation;
  if (!isRecord(operation) || typeof operation.commandId !== "string" || typeof operation.kind !== "string") {
    return undefined;
  }
  return { commandId: operation.commandId, kind: operation.kind };
}
