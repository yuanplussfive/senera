import { useCallback, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { toast } from "sonner";
import {
  EventKinds,
  type EventEnvelope,
  type PresetFailedData,
  type PresetFormat,
  type PresetItem,
  type PresetMutationState,
  type PresetOperationKind,
  type PresetSnapshotData,
  type WsRequest,
} from "../api/eventTypes";
import type { SocketStatus } from "../api/useAgentSocket";
import { generateId } from "../lib/util";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import { useStore } from "../store/sessionStore";

type PendingPresetOperation = {
  name?: string | null;
  kind: Extract<PresetOperationKind, "save" | "delete" | "set_active">;
};

type PresetMutationRequest = Extract<WsRequest, {
  type: "preset.save" | "preset.delete" | "preset.set_active";
}>;

export type PresetSaveInput = {
  name: string;
  format: PresetFormat;
  content: string;
  activate?: boolean;
};

export type PresetEventResolution =
  | {
      kind: "preset_success";
      requestId: string;
      name?: string | null;
    }
  | {
      kind: "preset_failed";
      requestId?: string;
      message: string;
    };

export interface PresetCommandsHandle {
  activePresetName: string | null;
  presetOperations: Record<string, PresetMutationState>;
  presetRootDir: string;
  presets: PresetItem[];
  presetsEnabled: boolean;
  handlePresetEvent: (env: EventEnvelope) => boolean;
  refreshPresets: () => void;
  savePreset: (input: PresetSaveInput) => string | null;
  deletePreset: (name: string) => string | null;
  setActivePreset: (name: string | null) => string | null;
}

export interface UsePresetCommandsOptions {
  send: (request: WsRequest) => boolean;
  status: SocketStatus;
}

export function resolvePresetEvent(
  env: EventEnvelope,
  pendingPresetRequestIds: ReadonlySet<string>,
): PresetEventResolution | null {
  if (env.kind === EventKinds.PresetSnapshot) {
    const data = env.data as PresetSnapshotData;
    const requestId = data.operation?.requestId;
    if (requestId && pendingPresetRequestIds.has(requestId)) {
      return {
        kind: "preset_success",
        requestId,
        name: data.operation?.name,
      };
    }
    return null;
  }

  if (env.kind === EventKinds.PresetFailed) {
    const data = env.data as PresetFailedData;
    const requestId = data.operation?.requestId;
    if (requestId && pendingPresetRequestIds.has(requestId)) {
      return {
        kind: "preset_failed",
        requestId,
        message: data.message,
      };
    }
  }

  return null;
}

export function usePresetCommands({
  send,
  status,
}: UsePresetCommandsOptions): PresetCommandsHandle {
  const presets = useStore((s) => s.presets);
  const activePresetName = useStore((s) => s.activePresetName);
  const presetsEnabled = useStore((s) => s.presetsEnabled);
  const presetRootDir = useStore((s) => s.presetRootDir);
  const [presetOperations, setPresetOperations] = useState<Record<string, PresetMutationState>>({});
  const pendingPresetOpsRef = useRef<Map<string, PendingPresetOperation>>(new Map());

  const handlePresetEvent = useCallback((env: EventEnvelope): boolean => {
    const resolution = resolvePresetEvent(env, new Set(pendingPresetOpsRef.current.keys()));
    if (!resolution) return false;

    if (resolution.kind === "preset_success") {
      const pending = pendingPresetOpsRef.current.get(resolution.requestId);
      if (!pending) return true;
      pendingPresetOpsRef.current.delete(resolution.requestId);
      setPresetOperations((operations) => ({
        ...operations,
        [resolution.requestId]: {
          requestId: resolution.requestId,
          name: resolution.name ?? pending.name,
          kind: pending.kind,
          status: "success",
          updatedAt: new Date().toISOString(),
        },
      }));
      toast.success(presetSuccessToast(pending.kind));
      return true;
    }

    const pending = resolution.requestId
      ? pendingPresetOpsRef.current.get(resolution.requestId)
      : undefined;
    if (resolution.requestId && pending) {
      const requestId = resolution.requestId;
      pendingPresetOpsRef.current.delete(requestId);
      setPresetOperations((operations) => ({
        ...operations,
        [requestId]: {
          requestId,
          name: pending.name,
          kind: pending.kind,
          status: "error",
          message: resolution.message,
          updatedAt: new Date().toISOString(),
        },
      }));
      toast.error(presetFailureToast(pending.kind), {
        description: resolution.message,
      });
      return true;
    }

    return false;
  }, []);

  const refreshPresets = useCallback((): void => {
    if (status !== "open") return;
    send({ type: "preset.list" });
  }, [send, status]);

  const savePreset = useCallback((input: PresetSaveInput): string | null => {
    return startPresetOperation({
      send,
      status,
      setPresetOperations,
      pendingPresetOpsRef,
      pending: {
        name: input.name,
        kind: "save",
      },
      request: {
        type: "preset.save",
        name: input.name,
        format: input.format,
        content: input.content,
        activate: input.activate,
      },
    });
  }, [send, status]);

  const deletePreset = useCallback((name: string): string | null => {
    return startPresetOperation({
      send,
      status,
      setPresetOperations,
      pendingPresetOpsRef,
      pending: {
        name,
        kind: "delete",
      },
      request: {
        type: "preset.delete",
        name,
      },
    });
  }, [send, status]);

  const setActivePreset = useCallback((name: string | null): string | null => {
    return startPresetOperation({
      send,
      status,
      setPresetOperations,
      pendingPresetOpsRef,
      pending: {
        name,
        kind: "set_active",
      },
      request: {
        type: "preset.set_active",
        name,
      },
    });
  }, [send, status]);

  return {
    activePresetName,
    presetOperations,
    presetRootDir,
    presets,
    presetsEnabled,
    handlePresetEvent,
    refreshPresets,
    savePreset,
    deletePreset,
    setActivePreset,
  };
}

function startPresetOperation({
  send,
  status,
  setPresetOperations,
  pendingPresetOpsRef,
  pending,
  request,
}: {
  send: (request: WsRequest) => boolean;
  status: SocketStatus;
  setPresetOperations: Dispatch<SetStateAction<Record<string, PresetMutationState>>>;
  pendingPresetOpsRef: MutableRefObject<Map<string, PendingPresetOperation>>;
  pending: PendingPresetOperation;
  request: PresetMutationRequest;
}): string | null {
  if (status !== "open") {
    toast.error(frontendMessage("preset.updateOffline"));
    return null;
  }

  const requestId = generateId();
  pendingPresetOpsRef.current.set(requestId, pending);
  setPresetOperations((operations) => ({
    ...operations,
    [requestId]: {
      requestId,
      name: pending.name,
      kind: pending.kind,
      status: "pending",
      updatedAt: new Date().toISOString(),
    },
  }));
  const ok = send({
    ...request,
    requestId,
  } as WsRequest);
  if (!ok) {
    pendingPresetOpsRef.current.delete(requestId);
    setPresetOperations((operations) => {
      const next = { ...operations };
      delete next[requestId];
      return next;
    });
    toast.error(frontendMessage("preset.updateDisconnected"));
    return null;
  }
  return requestId;
}

function presetSuccessToast(kind: PendingPresetOperation["kind"]): string {
  switch (kind) {
    case "save":
      return frontendMessage("preset.saved");
    case "delete":
      return frontendMessage("preset.deleted");
    case "set_active":
      return frontendMessage("preset.setActiveSucceeded");
  }
}

function presetFailureToast(kind: PendingPresetOperation["kind"]): string {
  switch (kind) {
    case "save":
      return frontendMessage("preset.saveFailed");
    case "delete":
      return frontendMessage("preset.deleteFailed");
    case "set_active":
      return frontendMessage("preset.setActiveFailed");
  }
}
