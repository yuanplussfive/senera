import { EventKinds, type ConfigFailedData, type ConfigSnapshotData, type EventEnvelope } from "../api/eventTypes";
import type {
  ProviderModelConfigOperationKind,
  ProviderModelConfigCommandDraft,
} from "../api/providerModelCommandTypes";
import type { FrontendMessageKey } from "../i18n/frontendMessageCatalog";
import { readConfigFailureCode } from "./configMutationFailure";

export type ProviderEndpointOperationKind = Extract<
  ProviderModelConfigOperationKind,
  "provider.endpoint.upsert" | "provider.endpoint.rename" | "provider.endpoint.delete"
>;

export type ProviderEndpointConfigRequest = Extract<
  ProviderModelConfigCommandDraft,
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
} as const satisfies Record<
  ProviderEndpointOperationKind,
  Record<"offline" | "configUnavailable" | "disconnected" | "success" | "failure", FrontendMessageKey>
>;

export type ProviderEndpointMutationResolution =
  | {
      kind: "success";
      operationKind: ProviderEndpointOperationKind;
      providerId: string;
      commandId: string;
    }
  | {
      kind: "failure";
      operationKind: ProviderEndpointOperationKind;
      providerId: string;
      commandId: string;
      message: string;
      errorCode?: string;
    };

export function resolveProviderEndpointMutationEvent(
  env: EventEnvelope,
  pendingOperations: ReadonlyMap<string, PendingProviderEndpointOperation>,
): ProviderEndpointMutationResolution | null {
  if (env.kind === EventKinds.ConfigSnapshot) {
    const operation = (env.data as ConfigSnapshotData).operation;
    const pending = readMatchingPendingOperation(operation?.commandId, operation?.kind, pendingOperations);
    return pending && operation?.commandId
      ? {
          kind: "success",
          operationKind: pending.kind,
          providerId: pending.providerId,
          commandId: operation.commandId,
        }
      : null;
  }

  if (env.kind === EventKinds.ConfigFailed) {
    const data = env.data as ConfigFailedData;
    const operation = data.operation && "commandId" in data.operation ? data.operation : undefined;
    const pending = readMatchingPendingOperation(operation?.commandId, operation?.kind, pendingOperations);
    return pending && operation?.commandId
      ? {
          kind: "failure",
          operationKind: pending.kind,
          providerId: pending.providerId,
          commandId: operation.commandId,
          message: data.message,
          errorCode: readConfigFailureCode(data.details),
        }
      : null;
  }

  return null;
}

function readMatchingPendingOperation(
  commandId: string | undefined,
  operationKind: unknown,
  pendingOperations: ReadonlyMap<string, PendingProviderEndpointOperation>,
): PendingProviderEndpointOperation | undefined {
  if (!commandId || !isProviderEndpointOperationKind(operationKind)) return undefined;
  const pending = pendingOperations.get(commandId);
  return pending?.kind === operationKind ? pending : undefined;
}

function isProviderEndpointOperationKind(kind: unknown): kind is ProviderEndpointOperationKind {
  return (
    kind === "provider.endpoint.upsert" || kind === "provider.endpoint.rename" || kind === "provider.endpoint.delete"
  );
}
