import {
  EventKinds,
  type ConfigFailedData,
  type ConfigSnapshotData,
  type EventEnvelope,
} from "../api/eventTypes";
import type {
  ConfigRevisionGuardRequestInput,
  ProviderModelConfigOperationKind,
  ProviderModelConfigRequest,
} from "../api/providerModelCommandTypes";
import type { FrontendMessageKey } from "../i18n/frontendMessageCatalog";

export type ProviderEndpointOperationKind = Extract<
  ProviderModelConfigOperationKind,
  "provider.endpoint.upsert" | "provider.endpoint.rename" | "provider.endpoint.delete"
>;

export type ProviderEndpointConfigRequest = Extract<
  ProviderModelConfigRequest,
  { type: ProviderEndpointOperationKind }
>;

export interface PendingProviderEndpointOperation {
  kind: ProviderEndpointOperationKind;
  providerId: string;
}

export interface ProviderEndpointDeleteOptions {
  cascadeModels?: boolean;
  replacementDefaultModelId?: string;
}

export const providerEndpointMessageKeys = {
  "provider.endpoint.upsert": {
    offline: "config.providerEndpointUpsertOffline",
    configUnavailable: "config.providerEndpointUpsertConfigUnavailable",
    disconnected: "config.providerEndpointUpsertDisconnected",
    success: "config.providerEndpointUpsertSucceeded",
    failure: "config.providerEndpointUpsertFailed",
  },
  "provider.endpoint.rename": {
    offline: "config.providerEndpointRenameOffline",
    configUnavailable: "config.providerEndpointRenameConfigUnavailable",
    disconnected: "config.providerEndpointRenameDisconnected",
    success: "config.providerEndpointRenameSucceeded",
    failure: "config.providerEndpointRenameFailed",
  },
  "provider.endpoint.delete": {
    offline: "config.providerEndpointDeleteOffline",
    configUnavailable: "config.providerEndpointDeleteConfigUnavailable",
    disconnected: "config.providerEndpointDeleteDisconnected",
    success: "config.providerEndpointDeleteSucceeded",
    failure: "config.providerEndpointDeleteFailed",
  },
} as const satisfies Record<ProviderEndpointOperationKind, Record<
  "offline" | "configUnavailable" | "disconnected" | "success" | "failure",
  FrontendMessageKey
>>;

export type ProviderEndpointMutationResolution =
  | {
      kind: "success";
      operationKind: ProviderEndpointOperationKind;
      providerId: string;
      requestId: string;
    }
  | {
      kind: "failure";
      operationKind: ProviderEndpointOperationKind;
      providerId: string;
      requestId: string;
      message: string;
    };

export function resolveProviderEndpointMutationEvent(
  env: EventEnvelope,
  pendingOperations: ReadonlyMap<string, PendingProviderEndpointOperation>,
): ProviderEndpointMutationResolution | null {
  if (env.kind === EventKinds.ConfigSnapshot) {
    const operation = (env.data as ConfigSnapshotData).operation;
    const pending = readMatchingPendingOperation(operation?.requestId, operation?.kind, pendingOperations);
    return pending && operation?.requestId
      ? {
          kind: "success",
          operationKind: pending.kind,
          providerId: pending.providerId,
          requestId: operation.requestId,
        }
      : null;
  }

  if (env.kind === EventKinds.ConfigFailed) {
    const data = env.data as ConfigFailedData;
    const pending = readMatchingPendingOperation(data.operation?.requestId, data.operation?.kind, pendingOperations);
    return pending && data.operation?.requestId
      ? {
          kind: "failure",
          operationKind: pending.kind,
          providerId: pending.providerId,
          requestId: data.operation.requestId,
          message: data.message,
        }
      : null;
  }

  return null;
}

export function readConfigRevisionGuard(
  snapshot: ConfigSnapshotData,
): Pick<ConfigRevisionGuardRequestInput, "expectedRevision" | "expectedVersion"> {
  return typeof snapshot.revision === "number"
    ? { expectedRevision: snapshot.revision }
    : { expectedVersion: snapshot.version };
}

function readMatchingPendingOperation(
  requestId: string | undefined,
  operationKind: unknown,
  pendingOperations: ReadonlyMap<string, PendingProviderEndpointOperation>,
): PendingProviderEndpointOperation | undefined {
  if (!requestId || !isProviderEndpointOperationKind(operationKind)) return undefined;
  const pending = pendingOperations.get(requestId);
  return pending?.kind === operationKind ? pending : undefined;
}

function isProviderEndpointOperationKind(kind: unknown): kind is ProviderEndpointOperationKind {
  return kind === "provider.endpoint.upsert"
    || kind === "provider.endpoint.rename"
    || kind === "provider.endpoint.delete";
}
