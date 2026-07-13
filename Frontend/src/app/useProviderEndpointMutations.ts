import { useCallback, useMemo, useReducer, useRef, type MutableRefObject } from "react";
import { toast } from "sonner";
import type {
  ConfigMutationState,
  ConfigSnapshotData,
  EventEnvelope,
  ProviderModelEndpointInput,
  WsRequest,
} from "../api/eventTypes";
import type { SocketStatus } from "../api/useAgentSocket";
import { generateId } from "../lib/util";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import {
  providerEndpointMessageKeys,
  readConfigRevisionGuard,
  resolveProviderEndpointMutationEvent,
  type PendingProviderEndpointOperation,
  type ProviderEndpointConfigRequest,
  type ProviderEndpointDeleteOptions,
} from "./providerEndpointMutations";

type SendRequest = (request: WsRequest) => boolean;

export interface ProviderEndpointMutationTransport {
  configSnapshot?: ConfigSnapshotData | null;
  sendRef: MutableRefObject<SendRequest | null>;
  statusRef: MutableRefObject<SocketStatus>;
}

type State = Record<string, ConfigMutationState>;
type Action =
  { type: "upsert"; providerId: string; operation: ConfigMutationState } | { type: "remove"; providerId: string };

export function useProviderEndpointMutations({
  configSnapshot = null,
  sendRef,
  statusRef,
}: ProviderEndpointMutationTransport) {
  const [operations, dispatch] = useReducer(reducer, {});
  const pendingRef = useRef<Map<string, PendingProviderEndpointOperation>>(new Map());

  const start = useCallback(
    (pending: PendingProviderEndpointOperation, request: ProviderEndpointConfigRequest): string | null => {
      const send = sendRef.current;
      const copy = providerEndpointMessageKeys[pending.kind];
      if (statusRef.current !== "open" || !send) {
        toast.error(frontendMessage(copy.offline));
        return null;
      }
      if (!configSnapshot) {
        toast.error(frontendMessage(copy.configUnavailable));
        return null;
      }
      const requestId = generateId();
      pendingRef.current.set(requestId, pending);
      dispatch({
        type: "upsert",
        providerId: pending.providerId,
        operation: { requestId, kind: pending.kind, status: "pending", updatedAt: timestamp() },
      });
      if (
        !send({
          ...request,
          ...readConfigRevisionGuard(configSnapshot),
          requestId,
          mirrorJson: true,
        } as ProviderEndpointConfigRequest)
      ) {
        pendingRef.current.delete(requestId);
        dispatch({ type: "remove", providerId: pending.providerId });
        toast.error(frontendMessage(copy.disconnected));
        return null;
      }
      return requestId;
    },
    [configSnapshot, sendRef, statusRef],
  );

  const upsertProviderEndpoint = useCallback(
    (endpoint: ProviderModelEndpointInput) =>
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
    pendingRef.current.delete(resolution.requestId);
    dispatch({
      type: "upsert",
      providerId: resolution.providerId,
      operation: {
        requestId: resolution.requestId,
        kind: resolution.operationKind,
        status: resolution.kind === "success" ? "success" : "error",
        ...(resolution.kind === "failure" ? { message: resolution.message } : {}),
        updatedAt: timestamp(),
      },
    });
    const copy = providerEndpointMessageKeys[resolution.operationKind];
    if (resolution.kind === "success") toast.success(frontendMessage(copy.success));
    else toast.error(frontendMessage(copy.failure), { description: resolution.message });
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
