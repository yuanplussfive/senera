import { useCallback, useMemo, useReducer, useRef } from "react";
import { toast } from "sonner";
import type { ConfigMutationState, EventEnvelope, ProviderModelEndpointPatchInput } from "../api/eventTypes";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import {
  providerEndpointMessageKeys,
  resolveProviderEndpointMutationEvent,
  type PendingProviderEndpointOperation,
  type ProviderEndpointConfigRequest,
  type ProviderEndpointDeleteOptions,
} from "./providerEndpointMutations";
import type { SystemConfigCommandQueue, SystemConfigCommandTransportFailure } from "./useSystemConfigCommandQueue";

export interface ProviderEndpointMutationTransport {
  commandQueue: SystemConfigCommandQueue;
}

type State = Record<string, ConfigMutationState>;
type Action =
  { type: "upsert"; providerId: string; operation: ConfigMutationState } | { type: "remove"; providerId: string };

export function useProviderEndpointMutations({ commandQueue }: ProviderEndpointMutationTransport) {
  const [operations, dispatch] = useReducer(reducer, {});
  const pendingRef = useRef<Map<string, PendingProviderEndpointOperation>>(new Map());

  const start = useCallback(
    (pending: PendingProviderEndpointOperation, request: ProviderEndpointConfigRequest): string | null => {
      const copy = providerEndpointMessageKeys[pending.kind];
      let commandId: string | null = null;
      const handleTransportFailure = (failure: SystemConfigCommandTransportFailure): void => {
        const messageKey =
          failure === "config_unavailable"
            ? copy.configUnavailable
            : failure === "offline"
              ? copy.offline
              : copy.disconnected;
        if (commandId) {
          pendingRef.current.delete(commandId);
          dispatch({
            type: "upsert",
            providerId: pending.providerId,
            operation: {
              commandId,
              kind: pending.kind,
              status: "error",
              message: frontendMessage(messageKey),
              updatedAt: timestamp(),
            },
          });
        }
        toast.error(frontendMessage(messageKey));
      };
      commandId = commandQueue.enqueue({
        operationKind: pending.kind,
        request,
        ...(pending.kind === "provider.endpoint.upsert"
          ? { coalesceKey: pending.kind + ":" + pending.providerId }
          : {}),
        onTransportFailure: handleTransportFailure,
      });
      if (!commandId) return null;
      pendingRef.current.set(commandId, pending);
      dispatch({
        type: "upsert",
        providerId: pending.providerId,
        operation: { commandId, kind: pending.kind, status: "pending", updatedAt: timestamp() },
      });
      return commandId;
    },
    [commandQueue],
  );

  const upsertProviderEndpoint = useCallback(
    (endpoint: ProviderModelEndpointPatchInput) =>
      start(
        { kind: "provider.endpoint.upsert", providerId: endpoint.Id },
        { type: "provider.endpoint.upsert", endpoint },
      ),
    [start],
  );
  const renameProviderEndpoint = useCallback(
    (providerId: string, nextProviderId: string) =>
      start(
        { kind: "provider.endpoint.rename", providerId },
        { type: "provider.endpoint.rename", providerId, nextProviderId },
      ),
    [start],
  );
  const deleteProviderEndpoint = useCallback(
    (providerId: string, options: ProviderEndpointDeleteOptions = {}) =>
      start(
        { kind: "provider.endpoint.delete", providerId },
        { type: "provider.endpoint.delete", providerId, ...options },
      ),
    [start],
  );

  const ingestProviderEndpointMutationEvent = useCallback((env: EventEnvelope): boolean => {
    const resolution = resolveProviderEndpointMutationEvent(env, pendingRef.current);
    if (!resolution) return false;
    pendingRef.current.delete(resolution.commandId);
    dispatch({
      type: "upsert",
      providerId: resolution.providerId,
      operation: {
        commandId: resolution.commandId,
        kind: resolution.operationKind,
        status: resolution.kind === "success" ? "success" : "error",
        ...(resolution.kind === "failure" ? { message: resolution.message, errorCode: resolution.errorCode } : {}),
        updatedAt: timestamp(),
      },
    });
    const copy = providerEndpointMessageKeys[resolution.operationKind];
    if (resolution.kind === "success") {
      if (resolution.operationKind !== "provider.endpoint.upsert") {
        toast.success(frontendMessage(copy.success));
      }
    } else {
      toast.error(frontendMessage(copy.failure), { description: resolution.message });
    }
    return true;
  }, []);

  return useMemo(
    () => ({
      deleteProviderEndpoint,
      ingestProviderEndpointMutationEvent,
      providerEndpointOperations: operations,
      renameProviderEndpoint,
      upsertProviderEndpoint,
    }),
    [
      deleteProviderEndpoint,
      ingestProviderEndpointMutationEvent,
      operations,
      renameProviderEndpoint,
      upsertProviderEndpoint,
    ],
  );
}

function reducer(state: State, action: Action): State {
  if (action.type === "upsert") return { ...state, [action.providerId]: action.operation };
  const next = { ...state };
  delete next[action.providerId];
  return next;
}

function timestamp(): string {
  return new Date().toISOString();
}
