import { useCallback, useMemo, useReducer, useRef } from "react";
import { toast } from "sonner";
import { type ConfigMutationState, type EventEnvelope } from "../api/eventTypes";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import {
  readMatchingProviderModelOperation,
  type PendingProviderModelOperation,
  type ProviderModelConfigRequest,
  type ProviderModelDeleteInput,
  type ProviderModelOperationKind,
  type ProviderModelUpsertInput,
} from "./providerModelMutations";
import type { SystemConfigCommandQueue, SystemConfigCommandTransportFailure } from "./useSystemConfigCommandQueue";

export interface ProviderModelMutationTransport {
  commandQueue: SystemConfigCommandQueue;
}

interface State {
  operations: Record<string, ConfigMutationState>;
}

type Action = { type: "upsert"; modelId: string; operation: ConfigMutationState } | { type: "remove"; modelId: string };

const initialState: State = { operations: {} };

export function useProviderModelMutations({ commandQueue }: ProviderModelMutationTransport) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const pendingRef = useRef<Map<string, PendingProviderModelOperation>>(new Map());
  const start = useCallback(
    (kind: ProviderModelOperationKind, modelId: string, request: ProviderModelConfigRequest): string | null => {
      let commandId: string | null = null;
      const handleTransportFailure = (failure: SystemConfigCommandTransportFailure): void => {
        const messageKey =
          failure === "config_unavailable"
            ? "config.mainFailed"
            : failure === "offline"
              ? "config.mainOffline"
              : "config.mainDisconnected";
        if (commandId) {
          pendingRef.current.delete(commandId);
          dispatch({
            type: "upsert",
            modelId,
            operation: {
              commandId,
              kind,
              status: "error",
              message: frontendMessage(messageKey),
              updatedAt: timestamp(),
            },
          });
        }
        toast.error(frontendMessage(messageKey));
      };
      commandId = commandQueue.enqueue({
        operationKind: kind,
        request,
        ...(kind === "provider.model.upsert" ? { coalesceKey: kind + ":" + modelId } : {}),
        onTransportFailure: handleTransportFailure,
      });
      if (!commandId) return null;
      pendingRef.current.set(commandId, { kind, modelId });
      dispatch({ type: "upsert", modelId, operation: { commandId, kind, status: "pending", updatedAt: timestamp() } });
      return commandId;
    },
    [commandQueue],
  );

  const upsertProviderModel = useCallback(
    (input: ProviderModelUpsertInput): string | null =>
      start("provider.model.upsert", input.model.Id, {
        type: "provider.model.upsert",
        model: input.model,
        ...(input.group ? { group: input.group } : {}),
      }),
    [start],
  );
  const deleteProviderModel = useCallback(
    (input: ProviderModelDeleteInput): string | null =>
      start("provider.model.delete", input.modelId, {
        type: "provider.model.delete",
        ...input,
      }),
    [start],
  );
  const setDefaultProviderModel = useCallback(
    (modelId: string): string | null =>
      start("provider.defaultModel.set", modelId, {
        type: "provider.defaultModel.set",
        modelId,
      }),
    [start],
  );

  const ingestConfigMutationEvent = useCallback((env: EventEnvelope): boolean => {
    const resolution = readMatchingProviderModelOperation(env, pendingRef.current);
    if (!resolution) return false;
    pendingRef.current.delete(resolution.commandId);
    dispatch({
      type: "upsert",
      modelId: resolution.operation.modelId,
      operation: {
        commandId: resolution.commandId,
        kind: resolution.operation.kind,
        status: resolution.kind === "success" ? "success" : "error",
        ...(resolution.message ? { message: resolution.message, errorCode: resolution.errorCode } : {}),
        updatedAt: timestamp(),
      },
    });
    if (resolution.kind === "success") {
      if (resolution.operation.kind === "provider.model.delete") {
        toast.success(frontendMessage("config.mainSaved"));
      }
    } else {
      toast.error(frontendMessage("config.mainFailed"), { description: resolution.message });
    }
    return true;
  }, []);

  return useMemo(
    () => ({
      deleteProviderModel,
      ingestConfigMutationEvent,
      providerModelOperations: state.operations,
      setDefaultProviderModel,
      upsertProviderModel,
    }),
    [deleteProviderModel, ingestConfigMutationEvent, setDefaultProviderModel, state.operations, upsertProviderModel],
  );
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
