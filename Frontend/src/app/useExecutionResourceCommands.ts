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

import { ExecutionResourceOutputStore } from "./executionResourceOutputStore";

export interface UseExecutionResourceCommandsResult {
  resources: ExecutionResourceSnapshotData[];
  outputStore: ExecutionResourceOutputStore;
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
  ensureInteractiveTerminal?: boolean;
}): UseExecutionResourceCommandsResult {
  const { activeSessionId, send, status, ensureInteractiveTerminal = false } = input;
  const [resources, setResources] = useState<ExecutionResourceSnapshotData[]>([]);
  const [resourceListSessionId, setResourceListSessionId] = useState<string | null>(null);
  const terminalEnsuredRef = useRef(false);
  const terminalStartPendingRef = useRef(false);
  const [outputStore] = useState(() => new ExecutionResourceOutputStore());
  const [projectionSessionId, setProjectionSessionId] = useState(activeSessionId);
  const resourcesRef = useRef(resources);
  resourcesRef.current = resources;
  const sessionRef = useRef(activeSessionId);
  sessionRef.current = activeSessionId;
  const closingResourceIdsRef = useRef(new Set<string>());
  const closingResourceStatesRef = useRef(new Map<string, ExecutionResourceSnapshotData["state"]>());
  const closedResourceIdsRef = useRef(new Set<string>());
  const recoveringResourceIdsRef = useRef(new Set<string>());
  const recoveryTargetCursorsRef = useRef(new Map<string, number>());

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
    (options: { cwd?: string; columns?: number; rows?: number } = {}) => {
      if (terminalStartPendingRef.current) return false;
      const sent = sendForSession((sessionId) => ({
        type: "execution.resource.start_terminal",
        sessionId,
        ...options,
      }));
      terminalStartPendingRef.current = sent;
      return sent;
    },
    [sendForSession],
  );

  useLayoutEffect(() => {
    closingResourceIdsRef.current.clear();
    closingResourceStatesRef.current.clear();
    closedResourceIdsRef.current.clear();
    recoveringResourceIdsRef.current.clear();
    recoveryTargetCursorsRef.current.clear();
    resourcesRef.current = [];
    outputStore.clear();
    setResources([]);
    setProjectionSessionId(activeSessionId);
    setResourceListSessionId(null);
    terminalEnsuredRef.current = false;
    terminalStartPendingRef.current = false;
  }, [activeSessionId, outputStore]);

  useEffect(() => {
    if (status === "open" && activeSessionId) refresh();
    else {
      setResourceListSessionId(null);
      terminalEnsuredRef.current = false;
      terminalStartPendingRef.current = false;
    }
  }, [activeSessionId, refresh, status]);

  useEffect(() => {
    if (!ensureInteractiveTerminal) {
      terminalEnsuredRef.current = false;
      return;
    }
    if (
      !activeSessionId ||
      status !== "open" ||
      resourceListSessionId !== activeSessionId ||
      terminalEnsuredRef.current
    )
      return;
    terminalEnsuredRef.current = true;
    const hasInteractiveTerminal = resources.some(
      (resource) =>
        resource.kind === "terminal" &&
        (resource.state === "starting" || resource.state === "running") &&
        resource.terminal?.capabilities.includes("interactive-input"),
    );
    if (!hasInteractiveTerminal) startTerminal();
  }, [activeSessionId, ensureInteractiveTerminal, resourceListSessionId, resources, startTerminal, status]);

  const mergeSnapshot = useCallback(
    (snapshot: ExecutionResourceSnapshotData): void => {
      if (closedResourceIdsRef.current.has(snapshot.resourceId)) return;
      setResources((current) => upsertResource(current, snapshot, closingResourceIdsRef.current));
      if (snapshot.events.length === 0) return;
      outputStore.merge(snapshot);
    },
    [outputStore],
  );

  const requestOutputRecovery = useCallback(
    (resourceId: string, targetCursor: number): void => {
      const sessionId = sessionRef.current;
      if (!sessionId) return;
      recoveryTargetCursorsRef.current.set(
        resourceId,
        Math.max(recoveryTargetCursorsRef.current.get(resourceId) ?? 0, targetCursor),
      );
      if (recoveringResourceIdsRef.current.has(resourceId)) return;
      if (
        send({ type: "execution.resource.inspect", sessionId, resourceId, cursor: outputStore.cursorOf(resourceId) })
      ) {
        recoveringResourceIdsRef.current.add(resourceId);
      } else recoveryTargetCursorsRef.current.delete(resourceId);
    },
    [outputStore, send],
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
        if (data.operation === "start_terminal") terminalStartPendingRef.current = false;
        if (data.operation === "list" || data.operation === "close") {
          if (data.operation === "list") setResourceListSessionId(sessionId);
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
          outputStore.retain(retainedIds);
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
              cursor: outputStore.cursorOf(resource.resourceId),
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
              const recoveredCursor = outputStore.cursorOf(resourceId);
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
        const currentCursor = outputStore.cursorOf(data.resourceId);
        const cursorStart = data.cursorStart ?? data.cursor;
        if (data.cursor <= currentCursor) return true;
        if (cursorStart > currentCursor + 1 || cursorStart <= currentCursor) {
          requestOutputRecovery(data.resourceId, data.cursor);
          return true;
        }
        outputStore.append(data.resourceId, data.cursor, data.text, data.truncated === true);
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
        outputStore.remove(data.resourceId);
        return true;
      }
      if (event.kind === EventKinds.ExecutionResourceState) {
        const data = event.data as ExecutionResourceStateData;
        if (closedResourceIdsRef.current.has(data.resourceId)) return true;
        // State shares the output journal's cursor sequence. A state update
        // cannot acknowledge missing output, including a shell's first prompt.
        const cursor = outputStore.cursorOf(data.resourceId);
        if (data.cursor > cursor + 1) requestOutputRecovery(data.resourceId, data.cursor);
        else outputStore.advance(data.resourceId, data.cursor);
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
        if (data.details?.requestType === "execution.resource.start_terminal") {
          terminalStartPendingRef.current = false;
          return false;
        }
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
    [mergeSnapshot, outputStore, refresh, requestOutputRecovery, send],
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
      outputStore,
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
    outputStore,
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
