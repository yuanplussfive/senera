import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import {
  EventKinds,
  type ConfigOperationKind,
  type ConfigSnapshotData,
  type EventEnvelope,
  type WsRequest,
} from "../api/eventTypes";
import type { SocketStatus } from "../api/useAgentSocket";
import { generateId } from "../lib/util";
import { readConfigCommandEventOperation } from "./configCommandOperation";

type SendRequest = (request: WsRequest) => boolean;
type SystemConfigCommandRequest = Extract<WsRequest, { commandId: string }>;
export type SystemConfigCommandDraft = SystemConfigCommandRequest extends infer Request
  ? Request extends SystemConfigCommandRequest
    ? Omit<Request, "commandId">
    : never
  : never;

export type SystemConfigCommandTransportFailure = "config_unavailable" | "offline" | "disconnected";

const COMMAND_RESPONSE_TIMEOUT_MS = 30_000;

export interface SystemConfigCommandEnqueueInput {
  operationKind: ConfigOperationKind;
  request: SystemConfigCommandDraft | ((snapshot: ConfigSnapshotData) => SystemConfigCommandDraft);
  coalesceKey?: string;
  onTransportFailure?: (failure: SystemConfigCommandTransportFailure) => void;
}

interface QueuedSystemConfigCommand extends SystemConfigCommandEnqueueInput {
  commandId: string;
  requestToSend?: SystemConfigCommandRequest;
  awaitingResponse: boolean;
  supportsDurableReplay?: boolean;
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
  const responseTimeoutRef = useRef<number | null>(null);
  latestSnapshotRef.current = configSnapshot ?? latestSnapshotRef.current;
  statusRef.current = status;

  const clearResponseTimeout = useCallback((): void => {
    if (responseTimeoutRef.current === null) return;
    window.clearTimeout(responseTimeoutRef.current);
    responseTimeoutRef.current = null;
  }, []);

  const failCommand = useCallback(
    (command: QueuedSystemConfigCommand, failure: SystemConfigCommandTransportFailure) => {
      command.onTransportFailure?.(failure);
    },
    [],
  );

  const pump = useCallback((): void => {
    if (statusRef.current !== "open") return;
    const send = sendRef.current;
    if (!send) return;

    while (true) {
      const command = activeRef.current ?? queuedRef.current.shift();
      if (!command || command.awaitingResponse) return;
      const snapshot = latestSnapshotRef.current;
      if (!snapshot) {
        activeRef.current = null;
        failCommand(command, "config_unavailable");
        continue;
      }

      const requestToSend =
        command.requestToSend ??
        ({
          ...(typeof command.request === "function" ? command.request(snapshot) : command.request),
          commandId: command.commandId,
        } as SystemConfigCommandRequest);
      command.requestToSend = requestToSend;
      command.supportsDurableReplay = snapshot.source === "sqlite";
      activeRef.current = command;
      if (send(requestToSend)) {
        command.awaitingResponse = true;
        // Safety net: a command that never gets a matching ConfigSnapshot/ConfigFailed
        // (e.g. rejected before reaching a handler) must not deadlock the queue forever.
        clearResponseTimeout();
        responseTimeoutRef.current = window.setTimeout(() => {
          responseTimeoutRef.current = null;
          const stalled = activeRef.current;
          if (!stalled || stalled.commandId !== command.commandId) return;
          activeRef.current = null;
          failCommand(stalled, "disconnected");
          pump();
        }, COMMAND_RESPONSE_TIMEOUT_MS);
        return;
      }
      activeRef.current = null;
      failCommand(command, "disconnected");
    }
  }, [clearResponseTimeout, failCommand, sendRef]);

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

      const command: QueuedSystemConfigCommand = { ...input, commandId: generateId(), awaitingResponse: false };
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
      const operation = readConfigCommandEventOperation(event);
      const commandId = operation?.commandId;
      if (
        !commandId ||
        activeRef.current?.commandId !== commandId ||
        operation?.kind !== activeRef.current.operationKind
      ) {
        return false;
      }
      activeRef.current = null;
      clearResponseTimeout();
      pump();
      return true;
    },
    [clearResponseTimeout, pump],
  );

  useEffect(() => {
    if (status === "open") {
      pump();
      return;
    }
    clearResponseTimeout();
    const active = activeRef.current;
    if (!active) return;
    if (active.supportsDurableReplay) {
      active.awaitingResponse = false;
      return;
    }
    activeRef.current = null;
    failCommand(active, "disconnected");
  }, [clearResponseTimeout, failCommand, pump, status]);

  return useMemo(() => ({ enqueue, ingest }), [enqueue, ingest]);
}
