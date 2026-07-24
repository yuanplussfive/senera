import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import {
  EventKinds,
  type ConfigFailedData,
  type ConfigOperationKind,
  type ConfigSnapshotData,
  type EventEnvelope,
  type WsRequest,
} from "../api/eventTypes";
import type { SocketStatus } from "../api/useAgentSocket";
import { generateId } from "../lib/util";

type SendRequest = (request: WsRequest) => boolean;
type SystemConfigCommandRequest = Extract<WsRequest, { commandId: string }>;
export type SystemConfigCommandDraft = SystemConfigCommandRequest extends infer Request
  ? Request extends SystemConfigCommandRequest
    ? Omit<Request, "commandId">
    : never
  : never;

export type SystemConfigCommandTransportFailure = "config_unavailable" | "offline" | "disconnected";

export interface SystemConfigCommandEnqueueInput {
  operationKind: ConfigOperationKind;
  request: SystemConfigCommandDraft | ((snapshot: ConfigSnapshotData) => SystemConfigCommandDraft);
  coalesceKey?: string;
  onTransportFailure?: (failure: SystemConfigCommandTransportFailure) => void;
}

interface QueuedSystemConfigCommand extends SystemConfigCommandEnqueueInput {
  commandId: string;
}

export interface SystemConfigCommandQueue {
  enqueue(input: SystemConfigCommandEnqueueInput): string | null;
  ingest(event: EventEnvelope): boolean;
}

export function useSystemConfigCommandQueue({
  configSnapshot,
  sendRef,
  status,
}: {
  configSnapshot: ConfigSnapshotData | null;
  sendRef: MutableRefObject<SendRequest | null>;
  status: SocketStatus;
}): SystemConfigCommandQueue {
  const latestSnapshotRef = useRef<ConfigSnapshotData | null>(configSnapshot);
  const activeRef = useRef<QueuedSystemConfigCommand | null>(null);
  const queuedRef = useRef<QueuedSystemConfigCommand[]>([]);
  const statusRef = useRef(status);
  latestSnapshotRef.current = configSnapshot ?? latestSnapshotRef.current;
  statusRef.current = status;

  const failCommand = useCallback(
    (command: QueuedSystemConfigCommand, failure: SystemConfigCommandTransportFailure) => {
      command.onTransportFailure?.(failure);
    },
    [],
  );

  const pump = useCallback((): void => {
    if (activeRef.current || statusRef.current !== "open") return;
    const send = sendRef.current;
    if (!send) return;

    while (!activeRef.current) {
      const command = queuedRef.current.shift();
      if (!command) return;
      const snapshot = latestSnapshotRef.current;
      if (!snapshot) {
        failCommand(command, "config_unavailable");
        continue;
      }
      const draft = typeof command.request === "function" ? command.request(snapshot) : command.request;
      activeRef.current = command;
      if (send({ ...draft, commandId: command.commandId } as SystemConfigCommandRequest)) return;
      activeRef.current = null;
      failCommand(command, "disconnected");
    }
  }, [failCommand, sendRef]);

  const enqueue = useCallback(
    (input: SystemConfigCommandEnqueueInput): string | null => {
      if (statusRef.current !== "open" || !sendRef.current) {
        input.onTransportFailure?.("offline");
        return null;
      }
      if (!latestSnapshotRef.current) {
        input.onTransportFailure?.("config_unavailable");
        return null;
      }

      if (input.coalesceKey) {
        const queued = queuedRef.current.find((candidate) => candidate.coalesceKey === input.coalesceKey);
        if (queued) {
          Object.assign(queued, input);
          return queued.commandId;
        }
      }

      const command: QueuedSystemConfigCommand = { ...input, commandId: generateId() };
      queuedRef.current.push(command);
      pump();
      return activeRef.current === command || queuedRef.current.includes(command) ? command.commandId : null;
    },
    [pump, sendRef],
  );

  const ingest = useCallback(
    (event: EventEnvelope): boolean => {
      if (event.kind === EventKinds.ConfigSnapshot) {
        latestSnapshotRef.current = event.data as ConfigSnapshotData;
      }
      if (event.kind !== EventKinds.ConfigSnapshot && event.kind !== EventKinds.ConfigFailed) return false;
      const data = event.data as ConfigSnapshotData | ConfigFailedData;
      const operation = data.operation && "commandId" in data.operation ? data.operation : undefined;
      const commandId = operation?.commandId;
      if (
        !commandId ||
        activeRef.current?.commandId !== commandId ||
        operation?.kind !== activeRef.current.operationKind
      ) {
        return false;
      }
      activeRef.current = null;
      pump();
      return true;
    },
    [pump],
  );

  useEffect(() => {
    if (status === "open") {
      pump();
      return;
    }
    const pending = [...(activeRef.current ? [activeRef.current] : []), ...queuedRef.current];
    activeRef.current = null;
    queuedRef.current = [];
    for (const command of pending) failCommand(command, "disconnected");
  }, [failCommand, pump, status]);

  return useMemo(() => ({ enqueue, ingest }), [enqueue, ingest]);
}
