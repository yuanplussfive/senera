import { useCallback, useMemo, useReducer, useRef } from "react";
import type { ConfigMutationState, ConfigOperationKind, EventEnvelope } from "../api/eventTypes";
import {
  resolveConfigEntityMutationEvent,
  type ConfigEntityMutationResolution,
  type PendingConfigEntityMutation,
} from "./configEntityMutation";
import type {
  SystemConfigCommandDraft,
  SystemConfigCommandQueue,
  SystemConfigCommandTransportFailure,
} from "./useSystemConfigCommandQueue";

interface ConfigEntityMutationState {
  readonly operations: Record<string, ConfigMutationState>;
}

interface ConfigEntityMutationUpsertAction {
  readonly type: "upsert";
  readonly entityId: string;
  readonly operation: ConfigMutationState;
}

export interface ConfigEntityMutationStartOptions {
  readonly coalesceKey?: string;
}

export interface ConfigEntityMutationLifecycle<TKind extends ConfigOperationKind> {
  readonly commandQueue: SystemConfigCommandQueue;
  readonly isOperationKind: (value: unknown) => value is TKind;
  readonly onResolution: (resolution: ConfigEntityMutationResolution<TKind>) => void;
  readonly onTransportFailure: (
    mutation: PendingConfigEntityMutation<TKind>,
    failure: SystemConfigCommandTransportFailure,
    message: string,
  ) => void;
  readonly transportFailureMessage: (
    mutation: PendingConfigEntityMutation<TKind>,
    failure: SystemConfigCommandTransportFailure,
  ) => string;
}

const InitialState: ConfigEntityMutationState = { operations: {} };

export function useConfigEntityMutations<TKind extends ConfigOperationKind>(
  lifecycle: ConfigEntityMutationLifecycle<TKind>,
) {
  const [state, dispatch] = useReducer(reduceConfigEntityMutation, InitialState);
  const pendingRef = useRef<Map<string, PendingConfigEntityMutation<TKind>>>(new Map());

  const start = useCallback(
    (
      mutation: PendingConfigEntityMutation<TKind>,
      request: SystemConfigCommandDraft,
      options: ConfigEntityMutationStartOptions = {},
    ): string | null => {
      let commandId: string | null = null;
      const handleTransportFailure = (failure: SystemConfigCommandTransportFailure): void => {
        const message = lifecycle.transportFailureMessage(mutation, failure);
        if (commandId) {
          pendingRef.current.delete(commandId);
          dispatch({
            type: "upsert",
            entityId: mutation.entityId,
            operation: createConfigMutationState(commandId, mutation.kind, "error", { message }),
          });
        }
        lifecycle.onTransportFailure(mutation, failure, message);
      };
      commandId = lifecycle.commandQueue.enqueue({
        operationKind: mutation.kind,
        request,
        ...options,
        onTransportFailure: handleTransportFailure,
      });
      if (!commandId) return null;
      pendingRef.current.set(commandId, mutation);
      dispatch({
        type: "upsert",
        entityId: mutation.entityId,
        operation: createConfigMutationState(commandId, mutation.kind, "pending"),
      });
      return commandId;
    },
    [lifecycle],
  );

  const ingest = useCallback(
    (event: EventEnvelope): boolean => {
      const resolution = resolveConfigEntityMutationEvent(event, pendingRef.current, lifecycle.isOperationKind);
      if (!resolution) return false;
      pendingRef.current.delete(resolution.commandId);
      dispatch({
        type: "upsert",
        entityId: resolution.mutation.entityId,
        operation: createConfigMutationState(
          resolution.commandId,
          resolution.mutation.kind,
          resolution.outcome === "success" ? "success" : "error",
          resolution.outcome === "failure"
            ? { message: resolution.message, errorCode: resolution.errorCode }
            : undefined,
        ),
      });
      lifecycle.onResolution(resolution);
      return true;
    },
    [lifecycle],
  );

  return useMemo(() => ({ ingest, operations: state.operations, start }), [ingest, start, state.operations]);
}

function reduceConfigEntityMutation(
  state: ConfigEntityMutationState,
  action: ConfigEntityMutationUpsertAction,
): ConfigEntityMutationState {
  return { operations: { ...state.operations, [action.entityId]: action.operation } };
}

function createConfigMutationState(
  commandId: string,
  kind: ConfigOperationKind,
  status: ConfigMutationState["status"],
  failure?: Pick<ConfigMutationState, "message" | "errorCode">,
): ConfigMutationState {
  return {
    commandId,
    kind,
    status,
    ...failure,
    updatedAt: new Date().toISOString(),
  };
}
