import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EventKinds,
  type EventEnvelope,
  type ExecutionResourceCreatedData,
  type ExecutionResourceOutputData,
  type ExecutionResourceRemovedData,
  type ExecutionResourceResizedData,
  type ExecutionResourceSnapshotData,
  type ExecutionResourceSnapshotEventData,
  type ExecutionResourceStateData,
  type WsRequest,
} from "../api/eventTypes";
import type { SocketStatus } from "../api/useAgentSocket";

const MaxTerminalBufferCharacters = 256 * 1024;
const TerminalTruncationMarker = "\r\n... earlier terminal output omitted ...\r\n";

export interface ExecutionResourceOutputBuffer {
  cursor: number;
  text: string;
  truncated: boolean;
}

export interface UseExecutionResourceCommandsResult {
  resources: ExecutionResourceSnapshotData[];
  outputs: Readonly<Record<string, ExecutionResourceOutputBuffer>>;
  handleEvent: (event: EventEnvelope) => boolean;
  refresh: () => boolean;
  write: (resourceId: string, input: string) => boolean;
  resize: (resourceId: string, columns: number, rows: number) => boolean;
  signal: (resourceId: string, signal: "interrupt" | "terminate" | "kill") => boolean;
  stopAll: () => boolean;
}

export function useExecutionResourceCommands(input: {
  activeSessionId: string | null;
  send: (request: WsRequest) => boolean;
  status: SocketStatus;
}): UseExecutionResourceCommandsResult {
  const { activeSessionId, send, status } = input;
  const [resources, setResources] = useState<ExecutionResourceSnapshotData[]>([]);
  const [outputs, setOutputs] = useState<Record<string, ExecutionResourceOutputBuffer>>({});
  const outputsRef = useRef(outputs);
  outputsRef.current = outputs;
  const sessionRef = useRef(activeSessionId);
  sessionRef.current = activeSessionId;

  const sendForSession = useCallback(
    (create: (sessionId: string) => WsRequest): boolean => {
      const sessionId = sessionRef.current;
      return !!sessionId && send(create(sessionId));
    },
    [send],
  );

  const refresh = useCallback(
    () => sendForSession((sessionId) => ({ type: "execution.resource.list", sessionId })),
    [sendForSession],
  );

  useEffect(() => {
    setResources([]);
    setOutputs({});
    if (status === "open" && activeSessionId) refresh();
  }, [activeSessionId, refresh, status]);

  const mergeSnapshot = useCallback((snapshot: ExecutionResourceSnapshotData): void => {
    setResources((current) => upsertResource(current, snapshot));
    if (snapshot.events.length === 0) return;
    setOutputs((current) => ({
      ...current,
      [snapshot.resourceId]: mergeResourceEvents(current[snapshot.resourceId], snapshot),
    }));
  }, []);

  const handleEvent = useCallback(
    (event: EventEnvelope): boolean => {
      const sessionId = sessionRef.current;
      if (!sessionId || event.sessionId !== sessionId) return false;
      if (event.kind === EventKinds.ExecutionResourceCreated) {
        const data = event.data as ExecutionResourceCreatedData;
        mergeSnapshot(data.resource);
        return true;
      }
      if (event.kind === EventKinds.ExecutionResourceSnapshot) {
        const data = event.data as ExecutionResourceSnapshotEventData;
        if (data.operation === "list") {
          setResources(data.resources);
          for (const resource of data.resources) {
            send({
              type: "execution.resource.inspect",
              sessionId,
              resourceId: resource.resourceId,
              cursor: outputsRef.current[resource.resourceId]?.cursor ?? 0,
            });
          }
        } else {
          for (const resource of data.resources) mergeSnapshot(resource);
        }
        return true;
      }
      if (event.kind === EventKinds.ExecutionResourceOutput) {
        const data = event.data as ExecutionResourceOutputData;
        const currentCursor = outputsRef.current[data.resourceId]?.cursor ?? 0;
        const cursorStart = data.cursorStart ?? data.cursor;
        if (cursorStart > currentCursor + 1) {
          send({
            type: "execution.resource.inspect",
            sessionId,
            resourceId: data.resourceId,
            cursor: currentCursor,
          });
        }
        setOutputs((current) => ({
          ...current,
          [data.resourceId]: appendOutput(current[data.resourceId], data.cursor, data.text, data.truncated === true),
        }));
        return true;
      }
      if (event.kind === EventKinds.ExecutionResourceResized) {
        const data = event.data as ExecutionResourceResizedData;
        setResources((current) =>
          current.map((resource) =>
            resource.resourceId === data.resourceId && resource.terminal
              ? {
                  ...resource,
                  terminal: { ...resource.terminal, columns: data.columns, rows: data.rows },
                  updatedAt: event.timestamp,
                }
              : resource,
          ),
        );
        return true;
      }
      if (event.kind === EventKinds.ExecutionResourceRemoved) {
        const data = event.data as ExecutionResourceRemovedData;
        setResources((current) => current.filter((resource) => resource.resourceId !== data.resourceId));
        setOutputs((current) => removeOutput(current, data.resourceId));
        return true;
      }
      if (event.kind === EventKinds.ExecutionResourceState) {
        const data = event.data as ExecutionResourceStateData;
        setResources((current) =>
          current.map((resource) =>
            resource.resourceId === data.resourceId
              ? {
                  ...resource,
                  state: data.state,
                  cursor: Math.max(resource.cursor, data.cursor),
                  exitCode: data.exitCode,
                  signal: data.signal,
                  updatedAt: event.timestamp,
                }
              : resource,
          ),
        );
        return true;
      }
      return false;
    },
    [mergeSnapshot, send],
  );
  const write = useCallback(
    (resourceId: string, value: string) =>
      sendForSession((sessionId) => ({
        type: "execution.resource.write",
        sessionId,
        resourceId,
        input: value,
      })),
    [sendForSession],
  );
  const resize = useCallback(
    (resourceId: string, columns: number, rows: number) =>
      sendForSession((sessionId) => ({
        type: "execution.resource.resize",
        sessionId,
        resourceId,
        columns,
        rows,
      })),
    [sendForSession],
  );
  const signal = useCallback(
    (resourceId: string, requestedSignal: "interrupt" | "terminate" | "kill") =>
      sendForSession((sessionId) => ({
        type: "execution.resource.signal",
        sessionId,
        resourceId,
        signal: requestedSignal,
      })),
    [sendForSession],
  );
  const stopAll = useCallback(
    () => sendForSession((sessionId) => ({ type: "execution.resource.stop_all", sessionId })),
    [sendForSession],
  );

  return useMemo(
    () => ({
      resources,
      outputs,
      handleEvent,
      refresh,
      write,
      resize,
      signal,
      stopAll,
    }),
    [handleEvent, outputs, refresh, resize, resources, signal, stopAll, write],
  );
}

function removeOutput(
  outputs: Record<string, ExecutionResourceOutputBuffer>,
  resourceId: string,
): Record<string, ExecutionResourceOutputBuffer> {
  if (!(resourceId in outputs)) return outputs;
  const { [resourceId]: _removed, ...remaining } = outputs;
  return remaining;
}

function upsertResource(
  resources: ExecutionResourceSnapshotData[],
  snapshot: ExecutionResourceSnapshotData,
): ExecutionResourceSnapshotData[] {
  const existing = resources.findIndex((resource) => resource.resourceId === snapshot.resourceId);
  if (existing < 0) return [...resources, snapshot];
  return resources.map((resource, index) => (index === existing ? snapshot : resource));
}

function mergeResourceEvents(
  current: ExecutionResourceOutputBuffer | undefined,
  snapshot: ExecutionResourceSnapshotData,
): ExecutionResourceOutputBuffer {
  let next = snapshot.truncated
    ? { cursor: snapshot.oldestCursor - 1, text: TerminalTruncationMarker, truncated: true }
    : (current ?? { cursor: 0, text: "", truncated: false });
  for (const event of snapshot.events) {
    if (event.kind === "output" && event.text)
      next = appendOutput(next, event.cursor, event.text, event.truncated === true);
    else next = { ...next, cursor: Math.max(next.cursor, event.cursor) };
  }
  return next;
}

function appendOutput(
  current: ExecutionResourceOutputBuffer | undefined,
  cursor: number,
  text: string,
  chunkTruncated = false,
): ExecutionResourceOutputBuffer {
  const previous = current ?? { cursor: 0, text: "", truncated: false };
  if (cursor <= previous.cursor) return previous;
  const combined = `${previous.text}${text}`;
  if (combined.length <= MaxTerminalBufferCharacters) {
    return { cursor, text: combined, truncated: previous.truncated || chunkTruncated };
  }
  const tailLength = MaxTerminalBufferCharacters - TerminalTruncationMarker.length;
  return {
    cursor,
    text: `${TerminalTruncationMarker}${combined.slice(-tailLength)}`,
    truncated: true,
  };
}
