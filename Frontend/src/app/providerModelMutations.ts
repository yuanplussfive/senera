import {
  EventKinds,
  type ConfigFailedData,
  type ConfigMutationState,
  type ConfigSnapshotData,
  type EventEnvelope,
} from "../api/eventTypes";
import type {
  ConfigRevisionGuardRequestInput,
  ProviderModelConfigInput,
  ProviderModelConfigOperationKind,
  ProviderModelConfigRequest as ProviderModelCommandRequest,
  ProviderModelGroupAssignmentInput,
} from "../api/providerModelCommandTypes";
import { readConfigFailureCode } from "./configMutationFailure";

export type ProviderModelOperationKind = Extract<
  ProviderModelConfigOperationKind,
  "provider.model.upsert" | "provider.model.delete" | "provider.defaultModel.set"
>;

export type ProviderModelConfigRequest = Extract<
  ProviderModelCommandRequest,
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

export function readConfigRevisionGuardForModel(
  snapshot: ConfigSnapshotData,
): Pick<ConfigRevisionGuardRequestInput, "expectedRevision" | "expectedVersion"> {
  return typeof snapshot.revision === "number"
    ? { expectedRevision: snapshot.revision }
    : { expectedVersion: snapshot.version };
}

export function readMatchingProviderModelOperation(
  env: EventEnvelope,
  pending: ReadonlyMap<string, PendingProviderModelOperation>,
): {
  kind: "success" | "failure";
  operation: PendingProviderModelOperation;
  requestId: string;
  message?: string;
  errorCode?: string;
} | null {
  const data =
    env.kind === EventKinds.ConfigSnapshot
      ? (env.data as ConfigSnapshotData)
      : env.kind === EventKinds.ConfigFailed
        ? (env.data as ConfigFailedData)
        : null;
  const requestId = data?.operation?.requestId;
  const operationKind = data?.operation?.kind;
  if (!requestId || !isProviderModelOperationKind(operationKind)) return null;
  const operation = pending.get(requestId);
  if (!operation || operation.kind !== operationKind) return null;
  return {
    kind: env.kind === EventKinds.ConfigSnapshot ? "success" : "failure",
    operation,
    requestId,
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
