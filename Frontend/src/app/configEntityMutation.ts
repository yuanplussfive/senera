import { EventKinds, type ConfigFailedData, type ConfigOperationKind, type EventEnvelope } from "../api/eventTypes";
import { readConfigCommandEventOperation } from "./configCommandOperation";
import { readConfigFailureCode } from "./configMutationFailure";
import type { SystemConfigCommandTransportFailure } from "./useSystemConfigCommandQueue";
import { resolveBackendMessage } from "../i18n/backendMessage";

export interface PendingConfigEntityMutation<TKind extends ConfigOperationKind> {
  readonly entityId: string;
  readonly kind: TKind;
}

export type ConfigEntityMutationResolution<TKind extends ConfigOperationKind> =
  | {
      readonly outcome: "success";
      readonly commandId: string;
      readonly mutation: PendingConfigEntityMutation<TKind>;
    }
  | {
      readonly outcome: "failure";
      readonly commandId: string;
      readonly mutation: PendingConfigEntityMutation<TKind>;
      readonly message: string;
      readonly errorCode?: string;
    };

export interface ConfigTransportFailureValues<T> {
  readonly configUnavailable: T;
  readonly disconnected: T;
  readonly offline: T;
}

const TransportFailureValueKeys = {
  config_unavailable: "configUnavailable",
  disconnected: "disconnected",
  offline: "offline",
} as const satisfies Record<SystemConfigCommandTransportFailure, keyof ConfigTransportFailureValues<unknown>>;

export function resolveConfigEntityMutationEvent<TKind extends ConfigOperationKind>(
  event: EventEnvelope,
  pending: ReadonlyMap<string, PendingConfigEntityMutation<TKind>>,
  isOperationKind: (value: unknown) => value is TKind,
): ConfigEntityMutationResolution<TKind> | null {
  if (event.kind !== EventKinds.ConfigSnapshot && event.kind !== EventKinds.ConfigFailed) return null;
  const operation = readConfigCommandEventOperation(event);
  if (!operation || !isOperationKind(operation.kind)) return null;
  const mutation = pending.get(operation.commandId);
  if (!mutation || mutation.kind !== operation.kind) return null;
  if (event.kind === EventKinds.ConfigSnapshot) {
    return { outcome: "success", commandId: operation.commandId, mutation };
  }
  const failure = event.data as ConfigFailedData;
  return {
    outcome: "failure",
    commandId: operation.commandId,
    mutation,
    message: resolveBackendMessage(failure) ?? failure.message,
    errorCode: readConfigFailureCode(failure.details),
  };
}

export function configTransportFailureValue<T>(
  failure: SystemConfigCommandTransportFailure,
  values: ConfigTransportFailureValues<T>,
): T {
  return values[TransportFailureValueKeys[failure]];
}
