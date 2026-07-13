import { useCallback, useMemo, useReducer, useRef, type MutableRefObject } from "react";
import { toast } from "sonner";
import {
  type ConfigMutationState,
  type ConfigSnapshotData,
  type EventEnvelope,
  type WsRequest,
} from "../api/eventTypes";
import type { SocketStatus } from "../api/useAgentSocket";
import { generateId } from "../lib/util";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import {
  readConfigRevisionGuardForModel,
  readMatchingProviderModelOperation,
  type PendingProviderModelOperation,
  type ProviderModelConfigRequest,
  type ProviderModelDeleteInput,
  type ProviderModelOperationKind,
  type ProviderModelUpsertInput,
} from "./providerModelMutations";

type SendRequest = (request: WsRequest) => boolean;

export interface ProviderModelMutationTransport {
  configSnapshot?: ConfigSnapshotData | null;
  sendRef: MutableRefObject<SendRequest | null>;
  statusRef: MutableRefObject<SocketStatus>;
}

interface State {
  operations: Record<string, ConfigMutationState>;
}

type Action =
  | { type: "upsert"; modelId: string; operation: ConfigMutationState }
  | { type: "remove"; modelId: string };

const initialState: State = { operations: {} };

export function useProviderModelMutations({
  configSnapshot = null,
  sendRef,
  statusRef,
}: ProviderModelMutationTransport) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const pendingRef = useRef<Map<string, PendingProviderModelOperation>>(new Map());
  const readOpenTransport = useCallback((): SendRequest | null => {
    const send = sendRef.current;
    if (statusRef.current !== "open" || !send) {
      toast.error(frontendMessage("config.mainOffline"));
      return null;
    }
    return send;
  }, [sendRef, statusRef]);

  const start = useCallback((kind: ProviderModelOperationKind, modelId: string, request: ProviderModelConfigRequest): string | null => {
    const send = readOpenTransport();
    if (!send || !configSnapshot) {
      if (!configSnapshot) toast.error(frontendMessage("config.mainFailed"));
      return null;
    }
    const requestId = generateId();
    pendingRef.current.set(requestId, { kind, modelId });
    dispatch({ type: "upsert", modelId, operation: { requestId, kind, status: "pending", updatedAt: timestamp() } });
    if (!send({ ...request, ...readConfigRevisionGuardForModel(configSnapshot), requestId, mirrorJson: true })) {
      pendingRef.current.delete(requestId);
      dispatch({ type: "remove", modelId });
      toast.error(frontendMessage("config.mainDisconnected"));
      return null;
    }
    return requestId;
  }, [configSnapshot, readOpenTransport]);

  const upsertProviderModel = useCallback((input: ProviderModelUpsertInput): string | null => start("provider.model.upsert", input.model.Id, {
    type: "provider.model.upsert",
    model: input.model,
    ...(input.group ? { group: input.group } : {}),
  }), [start]);
  const deleteProviderModel = useCallback((input: ProviderModelDeleteInput): string | null => start("provider.model.delete", input.modelId, {
    type: "provider.model.delete",
    ...input,
  }), [start]);
  const setDefaultProviderModel = useCallback((modelId: string): string | null => start("provider.defaultModel.set", modelId, {
    type: "provider.defaultModel.set",
    modelId,
  }), [start]);

  const ingestConfigMutationEvent = useCallback((env: EventEnvelope): boolean => {
    const resolution = readMatchingProviderModelOperation(env, pendingRef.current);
    if (!resolution) return false;
    pendingRef.current.delete(resolution.requestId);
    dispatch({
      type: "upsert",
      modelId: resolution.operation.modelId,
      operation: {
        requestId: resolution.requestId,
        kind: resolution.operation.kind,
        status: resolution.kind === "success" ? "success" : "error",
        ...(resolution.message ? { message: resolution.message } : {}),
        updatedAt: timestamp(),
      },
    });
    if (resolution.kind === "success") toast.success(frontendMessage("config.mainSaved"));
    else toast.error(frontendMessage("config.mainFailed"), { description: resolution.message });
    return true;
  }, []);

  return useMemo(() => ({
    deleteProviderModel,
    ingestConfigMutationEvent,
    providerModelOperations: state.operations,
    setDefaultProviderModel,
    upsertProviderModel,
  }), [deleteProviderModel, ingestConfigMutationEvent, setDefaultProviderModel, state.operations, upsertProviderModel]);
}

function reducer(state: State, action: Action): State {
  if (action.type === "upsert") {
    return { operations: { ...state.operations, [action.modelId]: action.operation } };
  }
  const operations = { ...state.operations };
  delete operations[action.modelId];
  return { operations };
}

function timestamp(): string {
  return new Date().toISOString();
}
