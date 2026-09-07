import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  generation: number;
  chunks: readonly ExecutionResourceOutputChunk[];
  text: string;
  truncated: boolean;
}

export interface ExecutionResourceOutputChunk {
  cursor: number;
  text: string;
}

export interface UseExecutionResourceCommandsResult {
  resources: ExecutionResourceSnapshotData[];
  outputs: Readonly<Record<string, ExecutionResourceOutputBuffer>>;
  handleEvent: (event: EventEnvelope) => boolean;
  startTerminal: (options?: { cwd?: string; columns?: number; rows?: number }) => boolean;
  refresh: () => boolean;
  write: (resourceId: string, input: string) => boolean;
  resize: (resourceId: string, columns: number, rows: number) => boolean;
  signal: (resourceId: string, signal: "interrupt" | "terminate" | "kill") => boolean;
  close: (resourceId: string) => boolean;
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
  const [projectionSessionId, setProjectionSessionId] = useState(activeSessionId);
  const outputsRef = useRef(outputs);
  outputsRef.current = outputs;
  const resourcesRef = useRef(resources);
  resourcesRef.current = resources;
  const sessionRef = useRef(activeSessionId);
  sessionRef.current = activeSessionId;
  const closingResourceIdsRef = useRef(new Set<string>());
  const closingResourceStatesRef = useRef(new Map<string, ExecutionResourceSnapshotData["state"]>());
  const closedResourceIdsRef = useRef(new Set<string>());
  const recoveringResourceIdsRef = useRef(new Set<string>());
  const recoveryTargetCursorsRef = useRef(new Map<string, number>());

  const updateOutputs = useCallback(
    (
      update: (current: Record<string, ExecutionResourceOutputBuffer>) => Record<string, ExecutionResourceOutputBuffer>,
    ): void => {
      const next = update(outputsRef.current);
      outputsRef.current = next;
      setOutputs(next);
    },
    [],
  );

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
  const startTerminal = useCallback(
    (options: { cwd?: string; columns?: number; rows?: number } = {}) =>
      sendForSession((sessionId) => ({
        type: "execution.resource.start_terminal",
        sessionId,
        ...options,
      })),
    [sendForSession],
  );

  useLayoutEffect(() => {
    closingResourceIdsRef.current.clear();
    closingResourceStatesRef.current.clear();
    closedResourceIdsRef.current.clear();
    recoveringResourceIdsRef.current.clear();
    recoveryTargetCursorsRef.current.clear();
    resourcesRef.current = [];
    outputsRef.current = {};
    setResources([]);
    setOutputs({});
    setProjectionSessionId(activeSessionId);
  }, [activeSessionId]);

  useEffect(() => {
    if (status === "open" && activeSessionId) refresh();
  }, [activeSessionId, refresh, status]);

  const mergeSnapshot = useCallback(
    (snapshot: ExecutionResourceSnapshotData): void => {
      if (closedResourceIdsRef.current.has(snapshot.resourceId)) return;
      setResources((current) => upsertResource(current, snapshot, closingResourceIdsRef.current));
      if (snapshot.events.length === 0) return;
      updateOutputs((current) => ({
        ...current,
        [snapshot.resourceId]: mergeResourceEvents(current[snapshot.resourceId], snapshot),
      }));
    },
    [updateOutputs],
  );

  const handleEvent = useCallback(
    (event: EventEnvelope): boolean => {
      const sessionId = sessionRef.current;
      if (!sessionId || event.sessionId !== sessionId) return false;
      if (event.kind === EventKinds.ExecutionResourceCreated) {
        const data = event.data as ExecutionResourceCreatedData;
        closingResourceIdsRef.current.delete(data.resource.resourceId);
        closingResourceStatesRef.current.delete(data.resource.resourceId);
        closedResourceIdsRef.current.delete(data.resource.resourceId);
        mergeSnapshot(data.resource);
        return true;
      }
      if (event.kind === EventKinds.ExecutionResourceSnapshot) {
        const data = event.data as ExecutionResourceSnapshotEventData;
        if (data.operation === "list" || data.operation === "close") {
          const returnedIds = new Set(data.resources.map((resource) => resource.resourceId));
          for (const resourceId of closingResourceIdsRef.current) {
            if (!returnedIds.has(resourceId)) {
              closingResourceIdsRef.current.delete(resourceId);
              closingResourceStatesRef.current.delete(resourceId);
              closedResourceIdsRef.current.add(resourceId);
            }
          }
          const visibleResources = data.resources.filter(
            (resource) => !closedResourceIdsRef.current.has(resource.resourceId),
          );
          setResources(
            visibleResources.map((resource) => markResourceClosing(resource, closingResourceIdsRef.current)),
          );
          const retainedIds = new Set(visibleResources.map((resource) => resource.resourceId));
          updateOutputs((current) =>
            Object.fromEntries(Object.entries(current).filter(([resourceId]) => retainedIds.has(resourceId))),
          );
          for (const resourceId of recoveringResourceIdsRef.current) {
            if (!retainedIds.has(resourceId)) {
              recoveringResourceIdsRef.current.delete(resourceId);
              recoveryTargetCursorsRef.current.delete(resourceId);
            }
          }
          for (const resource of visibleResources) {
            send({
              type: "execution.resource.inspect",
              sessionId,
              resourceId: resource.resourceId,
              cursor: outputsRef.current[resource.resourceId]?.cursor ?? 0,
            });
          }
        } else {
          for (const resource of data.resources) mergeSnapshot(resource);
          if (data.operation === "inspect") {
            for (const resource of data.resources) {
              const resourceId = resource.resourceId;
              recoveringResourceIdsRef.current.delete(resourceId);
              const targetCursor = recoveryTargetCursorsRef.current.get(resourceId) ?? 0;
              recoveryTargetCursorsRef.current.delete(resourceId);
              const recoveredCursor = outputsRef.current[resourceId]?.cursor ?? 0;
              if (targetCursor > recoveredCursor) {
                const requested = send({
                  type: "execution.resource.inspect",
                  sessionId,
                  resourceId,
                  cursor: recoveredCursor,
                });
                if (requested) {
                  recoveringResourceIdsRef.current.add(resourceId);
                  recoveryTargetCursorsRef.current.set(resourceId, targetCursor);
                }
              }
            }
          }
        }
        return true;
      }
      if (event.kind === EventKinds.ExecutionResourceOutput) {
        const data = event.data as ExecutionResourceOutputData;
        if (closedResourceIdsRef.current.has(data.resourceId)) return true;
        const currentCursor = outputsRef.current[data.resourceId]?.cursor ?? 0;
        const cursorStart = data.cursorStart ?? data.cursor;
        if (data.cursor <= currentCursor) return true;
        if (cursorStart > currentCursor + 1 || cursorStart <= currentCursor) {
          recoveryTargetCursorsRef.current.set(
            data.resourceId,
            Math.max(recoveryTargetCursorsRef.current.get(data.resourceId) ?? 0, data.cursor),
          );
          if (recoveringResourceIdsRef.current.has(data.resourceId)) return true;
          const recoveryRequested = send({
            type: "execution.resource.inspect",
            sessionId,
            resourceId: data.resourceId,
            cursor: currentCursor,
          });
          if (recoveryRequested) {
            recoveringResourceIdsRef.current.add(data.resourceId);
          } else {
            recoveryTargetCursorsRef.current.delete(data.resourceId);
          }
          return true;
        }
        updateOutputs((current) => ({
          ...current,
          [data.resourceId]: appendOutput(current[data.resourceId], data.cursor, data.text, data.truncated === true),
        }));
        return true;
      }
      if (event.kind === EventKinds.ExecutionResourceResized) {
        const data = event.data as ExecutionResourceResizedData;
        if (closedResourceIdsRef.current.has(data.resourceId)) return true;
        setResources((current) =>
          current.map((resource) =>
            resource.resourceId === data.resourceId && resource.terminal
              ? {
                  ...resource,
                  terminal: { ...resource.terminal, columns: data.columns, rows: data.rows },
                  ...(closingResourceIdsRef.current.has(data.resourceId) ? { state: "stopping" as const } : {}),
                  updatedAt: event.timestamp,
                }
              : resource,
          ),
        );
        return true;
      }
      if (event.kind === EventKinds.ExecutionResourceRemoved) {
        const data = event.data as ExecutionResourceRemovedData;
        closingResourceIdsRef.current.delete(data.resourceId);
        closingResourceStatesRef.current.delete(data.resourceId);
        closedResourceIdsRef.current.add(data.resourceId);
        recoveringResourceIdsRef.current.delete(data.resourceId);
        recoveryTargetCursorsRef.current.delete(data.resourceId);
        setResources((current) => current.filter((resource) => resource.resourceId !== data.resourceId));
        updateOutputs((current) => removeOutput(current, data.resourceId));
        return true;
      }
      if (event.kind === EventKinds.ExecutionResourceState) {
        const data = event.data as ExecutionResourceStateData;
        if (closedResourceIdsRef.current.has(data.resourceId)) return true;
        updateOutputs((current) => advanceOutputCursor(current, data.resourceId, data.cursor));
        setResources((current) =>
          current.map((resource) =>
            resource.resourceId === data.resourceId
              ? {
                  ...resource,
                  state: closingResourceIdsRef.current.has(data.resourceId) ? "stopping" : data.state,
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
      if (event.kind === EventKinds.RequestInvalid) {
        const data = event.data as { details?: { requestType?: unknown; resourceId?: unknown } };
        if (data.details?.requestType === "execution.resource.inspect" && typeof data.details.resourceId === "string") {
          recoveringResourceIdsRef.current.delete(data.details.resourceId);
          recoveryTargetCursorsRef.current.delete(data.details.resourceId);
          void refresh();
          return true;
        }
        if (data.details?.requestType === "execution.resource.close" && typeof data.details.resourceId === "string") {
          const resourceId = data.details.resourceId;
          closingResourceIdsRef.current.delete(resourceId);
          const previousState = closingResourceStatesRef.current.get(resourceId);
          closingResourceStatesRef.current.delete(resourceId);
          if (previousState) {
            setResources((current) =>
              current.map((resource) =>
                resource.resourceId === resourceId ? { ...resource, state: previousState } : resource,
              ),
            );
          }
          void refresh();
          return true;
        }
      }
      return false;
    },
    [mergeSnapshot, refresh, send, updateOutputs],
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
  const close = useCallback(
    (resourceId: string): boolean => {
      if (closedResourceIdsRef.current.has(resourceId) || closingResourceIdsRef.current.has(resourceId)) return false;
      const previousState = resourcesRef.current.find((resource) => resource.resourceId === resourceId)?.state;
      closingResourceIdsRef.current.add(resourceId);
      if (previousState) closingResourceStatesRef.current.set(resourceId, previousState);
      setResources((current) =>
        current.map((resource) =>
          resource.resourceId === resourceId ? { ...resource, state: "stopping" as const } : resource,
        ),
      );
      const sent = sendForSession((sessionId) => ({ type: "execution.resource.close", sessionId, resourceId }));
      if (!sent) {
        closingResourceIdsRef.current.delete(resourceId);
        closingResourceStatesRef.current.delete(resourceId);
        if (previousState) {
          setResources((current) =>
            current.map((resource) =>
              resource.resourceId === resourceId ? { ...resource, state: previousState } : resource,
            ),
          );
        }
        void refresh();
      }
      return sent;
    },
    [refresh, sendForSession],
  );

  return useMemo(() => {
    const projectionIsCurrent = projectionSessionId === activeSessionId;
    return {
      resources: projectionIsCurrent ? resources : [],
      outputs: projectionIsCurrent ? outputs : {},
      handleEvent,
      startTerminal,
      refresh,
      write,
      resize,
      signal,
      close,
      stopAll,
    };
  }, [
    activeSessionId,
    close,
    handleEvent,
    outputs,
    projectionSessionId,
    refresh,
    resize,
    resources,
    signal,
    startTerminal,
    stopAll,
    write,
  ]);
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
  closingResourceIds: ReadonlySet<string>,
): ExecutionResourceSnapshotData[] {
  const existing = resources.findIndex((resource) => resource.resourceId === snapshot.resourceId);
  const projected = markResourceClosing(snapshot, closingResourceIds);
  if (existing < 0) return [...resources, projected];
  return resources.map((resource, index) => (index === existing ? projected : resource));
}

function markResourceClosing(
  resource: ExecutionResourceSnapshotData,
  closingResourceIds: ReadonlySet<string>,
): ExecutionResourceSnapshotData {
  return closingResourceIds.has(resource.resourceId) ? { ...resource, state: "stopping" } : resource;
}

function mergeResourceEvents(
  current: ExecutionResourceOutputBuffer | undefined,
  snapshot: ExecutionResourceSnapshotData,
): ExecutionResourceOutputBuffer {
  if (current && snapshot.cursor <= current.cursor) return current;
  const requiresReplay = snapshot.truncated && (!current || current.cursor < snapshot.oldestCursor - 1);
  let next = requiresReplay
    ? createOutputBuffer({
        cursor: snapshot.oldestCursor - 1,
        generation: (current?.generation ?? 0) + 1,
        text: TerminalTruncationMarker,
        truncated: true,
      })
    : (current ?? createOutputBuffer());
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
  const previous = current ?? createOutputBuffer();
  if (cursor <= previous.cursor) return previous;
  const combined = `${previous.text}${text}`;
  const chunks = appendBoundedOutputChunk(previous.chunks, { cursor, text });
  if (combined.length <= MaxTerminalBufferCharacters) {
    return {
      cursor,
      generation: previous.generation,
      chunks,
      text: combined,
      truncated: previous.truncated || chunkTruncated,
    };
  }
  const tailLength = MaxTerminalBufferCharacters - TerminalTruncationMarker.length;
  return {
    cursor,
    generation: previous.generation,
    chunks,
    text: `${TerminalTruncationMarker}${combined.slice(-tailLength)}`,
    truncated: true,
  };
}

function createOutputBuffer(
  initial: Partial<Pick<ExecutionResourceOutputBuffer, "cursor" | "generation" | "text" | "truncated">> = {},
): ExecutionResourceOutputBuffer {
  return {
    cursor: initial.cursor ?? 0,
    generation: initial.generation ?? 0,
    chunks: [],
    text: initial.text ?? "",
    truncated: initial.truncated ?? false,
  };
}

function appendBoundedOutputChunk(
  current: readonly ExecutionResourceOutputChunk[],
  chunk: ExecutionResourceOutputChunk,
): readonly ExecutionResourceOutputChunk[] {
  const chunks = [...current, chunk];
  let characterCount = chunks.reduce((total, entry) => total + entry.text.length, 0);
  while (characterCount > MaxTerminalBufferCharacters && chunks.length > 1) {
    characterCount -= chunks.shift()?.text.length ?? 0;
  }
  return chunks;
}

function advanceOutputCursor(
  outputs: Record<string, ExecutionResourceOutputBuffer>,
  resourceId: string,
  cursor: number,
): Record<string, ExecutionResourceOutputBuffer> {
  const current = outputs[resourceId];
  if (cursor <= (current?.cursor ?? 0)) return outputs;
  return {
    ...outputs,
    [resourceId]: current ? { ...current, cursor } : { ...createOutputBuffer(), cursor },
  };
}
