import {
  EventKinds,
  type ConfigFailedData,
  type ConfigMutationState,
  type ConfigSnapshotData,
  type EventEnvelope,
} from "../api/eventTypes";
import type {
  ProviderModelConfigInput,
  ProviderModelConfigOperationKind,
  ProviderModelConfigCommandDraft as ProviderModelCommandDraft,
  ProviderModelGroupAssignmentInput,
} from "../api/providerModelCommandTypes";
import { readConfigFailureCode } from "./configMutationFailure";

export type ProviderModelOperationKind = Extract<
  ProviderModelConfigOperationKind,
  "provider.model.upsert" | "provider.model.delete" | "provider.defaultModel.set"
>;

export type ProviderModelConfigRequest = Extract<
  ProviderModelCommandDraft,
  {
    type: ProviderModelOperationKind;
  }
>;

export interface PendingProviderModelOperation {
  kind: ProviderModelOperationKind;
  modelId: string;
}

export interface ProviderModelMutationState extends ConfigMutationState {
  kind: ProviderModelOperationKind;
  modelId: string;
}

export function readMatchingProviderModelOperation(
  env: EventEnvelope,
  pending: ReadonlyMap<string, PendingProviderModelOperation>,
): {
  kind: "success" | "failure";
  operation: PendingProviderModelOperation;
  commandId: string;
  message?: string;
  errorCode?: string;
} | null {
  const data =
    env.kind === EventKinds.ConfigSnapshot
      ? (env.data as ConfigSnapshotData)
      : env.kind === EventKinds.ConfigFailed
        ? (env.data as ConfigFailedData)
        : null;
  const eventOperation = data?.operation && "commandId" in data.operation ? data.operation : undefined;
  const commandId = eventOperation?.commandId;
  const operationKind = eventOperation?.kind;
  if (!commandId || !isProviderModelOperationKind(operationKind)) return null;
  const operation = pending.get(commandId);
  if (!operation || operation.kind !== operationKind) return null;
  return {
    kind: env.kind === EventKinds.ConfigSnapshot ? "success" : "failure",
    operation,
    commandId,
    ...(env.kind === EventKinds.ConfigFailed
      ? {
          message: (data as ConfigFailedData).message,
          errorCode: readConfigFailureCode((data as ConfigFailedData).details),
        }
      : {}),
  };
}

export function isProviderModelOperationKind(value: unknown): value is ProviderModelOperationKind {
  return (
    value === "provider.model.upsert" || value === "provider.model.delete" || value === "provider.defaultModel.set"
  );
}

export type ProviderModelUpsertInput = {
  model: ProviderModelConfigInput;
  group?: ProviderModelGroupAssignmentInput;
};

export type ProviderModelDeleteInput = {
  modelId: string;
  replacementDefaultModelId?: string;
};
