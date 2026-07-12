import { useCallback, useMemo, useReducer, useRef } from "react";
import { toast } from "sonner";
import {
  EventKinds,
  type EventEnvelope,
  type PresetFailedData,
  type PresetFormat,
  type PresetMutationState,
  type PresetSnapshotData,
  type WsRequest,
} from "../api/eventTypes";
import { generateId } from "../lib/util";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import type { ConfigMutationTransport } from "./useConfigMutationTransport";

interface PendingPresetOperation {
  name?: string | null;
  kind: "save" | "delete" | "set_active";
}

type PresetMutationAction = { type: "upsert"; operation: PresetMutationState } | { type: "remove"; requestId: string };

const presetCopy = {
  save: {
    success: frontendMessage("preset.saved"),
    failure: frontendMessage("preset.saveFailed"),
  },
  delete: {
    success: frontendMessage("preset.deleted"),
    failure: frontendMessage("preset.deleteFailed"),
  },
  set_active: {
    success: frontendMessage("preset.setActiveSucceeded"),
    failure: frontendMessage("preset.setActiveFailed"),
  },
} satisfies Record<PendingPresetOperation["kind"], Record<"success" | "failure", string>>;

type PresetMutationRequest = Extract<WsRequest, { type: "preset.save" | "preset.delete" | "preset.set_active" }>;

export interface PresetMutations {
  deletePreset: (name: string) => string | null;
  ingestEvent: (env: EventEnvelope) => boolean;
  operations: Record<string, PresetMutationState>;
  refresh: () => void;
  savePreset: (input: { name: string; format: PresetFormat; content: string; activate?: boolean }) => string | null;
  setActivePreset: (name: string | null) => string | null;
}

export function usePresetMutations(transport: ConfigMutationTransport): PresetMutations {
  const [operations, dispatch] = useReducer(presetMutationReducer, {});
  const pendingRef = useRef<Map<string, PendingPresetOperation>>(new Map());

  const refresh = useCallback((): void => {
    transport.sendWhenOpen({ type: "preset.list" });
  }, [transport]);

  const startOperation = useCallback(
    (pending: PendingPresetOperation, request: PresetMutationRequest): string | null => {
      const send = transport.readOpenTransport(frontendMessage("preset.updateOffline"));
      if (!send) return null;

      const requestId = generateId();
      pendingRef.current.set(requestId, pending);
      dispatch({
        type: "upsert",
        operation: {
          requestId,
          name: pending.name,
          kind: pending.kind,
          status: "pending",
          updatedAt: timestamp(),
        },
      });

      if (send({ ...request, requestId })) {
        return requestId;
      }

      pendingRef.current.delete(requestId);
      dispatch({ type: "remove", requestId });
      toast.error(frontendMessage("preset.updateDisconnected"));
      return null;
    },
    [transport],
  );

  const savePreset = useCallback(
    (input: { name: string; format: PresetFormat; content: string; activate?: boolean }): string | null =>
      startOperation(
        { name: input.name, kind: "save" },
        {
          type: "preset.save",
          name: input.name,
          format: input.format,
          content: input.content,
          activate: input.activate,
        },
      ),
    [startOperation],
  );

  const deletePreset = useCallback(
    (name: string): string | null =>
      startOperation(
        { name, kind: "delete" },
        {
          type: "preset.delete",
          name,
        },
      ),
    [startOperation],
  );

  const setActivePreset = useCallback(
    (name: string | null): string | null =>
      startOperation(
        { name, kind: "set_active" },
        {
          type: "preset.set_active",
          name,
        },
      ),
    [startOperation],
  );

  const ingestEvent = useCallback((env: EventEnvelope): boolean => {
    if (env.kind === EventKinds.PresetSnapshot) {
      const data = env.data as PresetSnapshotData;
      const requestId = data.operation?.requestId;
      const pending = requestId ? pendingRef.current.get(requestId) : undefined;
      if (requestId && pending) {
        pendingRef.current.delete(requestId);
        dispatch({
          type: "upsert",
          operation: {
            requestId,
            name: data.operation?.name ?? pending.name,
            kind: pending.kind,
            status: "success",
            updatedAt: timestamp(),
          },
        });
        toast.success(presetCopy[pending.kind].success);
      }
      return true;
    }

    if (env.kind !== EventKinds.PresetFailed) return false;
    const data = env.data as PresetFailedData;
    const requestId = data.operation?.requestId;
    const pending = requestId ? pendingRef.current.get(requestId) : undefined;
    if (requestId && pending) {
      pendingRef.current.delete(requestId);
      dispatch({
        type: "upsert",
        operation: {
          requestId,
          name: pending.name,
          kind: pending.kind,
          status: "error",
          message: data.message,
          updatedAt: timestamp(),
        },
      });
      toast.error(presetCopy[pending.kind].failure, {
        description: data.message,
      });
    }
    return true;
  }, []);

  return useMemo(
    () => ({
      deletePreset,
      ingestEvent,
      operations,
      refresh,
      savePreset,
      setActivePreset,
    }),
    [deletePreset, ingestEvent, operations, refresh, savePreset, setActivePreset],
  );
}

function presetMutationReducer(
  state: Record<string, PresetMutationState>,
  action: PresetMutationAction,
): Record<string, PresetMutationState> {
  if (action.type === "upsert") {
    return {
      ...state,
      [action.operation.requestId]: action.operation,
    };
  }
  const next = { ...state };
  delete next[action.requestId];
  return next;
}

function timestamp(): string {
  return new Date().toISOString();
}
