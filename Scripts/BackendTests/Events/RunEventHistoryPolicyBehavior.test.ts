import { describe, expect, test } from "vitest";
import {
  AgentEventChannels,
  AgentEventKinds,
  AgentEventLayers,
  AgentEventPhases,
} from "../../../Source/AgentSystem/Events/AgentEventCatalog.js";
import { projectAgentRunEventForHistory } from "../../../Source/AgentSystem/Events/AgentRunEventHistoryPolicy.js";
import { projectAgentMessage } from "../../../Source/AgentSystem/I18n/AgentMessageProjection.js";

describe("run event history policy", () => {
  test("persists message feedback so a reload restores the user's own rating", () => {
    const projected = projectAgentRunEventForHistory({
      channel: AgentEventChannels.AgentEvent,
      kind: AgentEventKinds.FeedbackRecorded,
      layer: AgentEventLayers.Snapshot,
      phase: AgentEventPhases.Session,
      sequence: 2,
      timestamp: "2026-07-17T00:00:00.000Z",
      sessionId: "session-1",
      requestId: "request-1",
      data: {
        sessionId: "session-1",
        requestId: "request-1",
        rating: "negative",
        category: "task_result",
        updatedAt: "2026-07-17T00:00:00.000Z",
      },
    });

    expect(projected?.data).toEqual({
      sessionId: "session-1",
      requestId: "request-1",
      rating: "negative",
      category: "task_result",
      updatedAt: "2026-07-17T00:00:00.000Z",
    });
  });

  test("still drops transport-level session events", () => {
    const projected = projectAgentRunEventForHistory({
      channel: AgentEventChannels.AgentEvent,
      kind: AgentEventKinds.SessionRuntimeStatus,
      layer: AgentEventLayers.Snapshot,
      phase: AgentEventPhases.Session,
      sequence: 3,
      timestamp: "2026-07-17T00:00:00.000Z",
      sessionId: "session-1",
      requestId: "request-1",
      data: {},
    });

    expect(projected).toBeUndefined();
  });

  test("does not persist transient run activity", () => {
    const projected = projectAgentRunEventForHistory({
      channel: AgentEventChannels.AgentEvent,
      kind: AgentEventKinds.RunActivityChanged,
      layer: AgentEventLayers.Progress,
      phase: AgentEventPhases.Run,
      sequence: 1,
      timestamp: "2026-07-17T00:00:00.000Z",
      sessionId: "session-1",
      requestId: "request-1",
      step: 1,
      data: {
        activityId: "activity-1",
        activity: "running_agent_turn",
        state: "started",
      },
    });

    expect(projected).toBeUndefined();
  });

  test("does not persist thinking deltas but preserves each completed reasoning block once", () => {
    const context = {
      channel: AgentEventChannels.AgentEvent,
      layer: AgentEventLayers.Progress,
      phase: AgentEventPhases.Model,
      sequence: 2,
      timestamp: "2026-07-17T00:00:00.000Z",
      sessionId: "session-1",
      requestId: "request-1",
      step: 1,
    } as const;

    expect(
      projectAgentRunEventForHistory({
        ...context,
        kind: AgentEventKinds.ModelThinkingDelta,
        data: { messageIndex: 0, contentIndex: 1, delta: "private stream text" },
      }),
    ).toBeUndefined();

    const completed = projectAgentRunEventForHistory({
      ...context,
      kind: AgentEventKinds.ModelThinkingCompleted,
      layer: AgentEventLayers.Snapshot,
      data: {
        messageIndex: 0,
        contentIndex: 1,
        content: "Completed native thinking block.",
        status: "complete",
      },
    });
    expect(completed?.data).toEqual({
      messageIndex: 0,
      contentIndex: 1,
      content: "Completed native thinking block.",
      status: "complete",
    });
  });

  test("persists model completion metadata without duplicating response text", () => {
    const projected = projectAgentRunEventForHistory({
      channel: AgentEventChannels.AgentEvent,
      kind: AgentEventKinds.ModelCompleted,
      layer: AgentEventLayers.Snapshot,
      phase: AgentEventPhases.Model,
      sequence: 1,
      timestamp: "2026-07-17T00:00:00.000Z",
      sessionId: "session-1",
      requestId: "request-1",
      step: 1,
      data: {
        text: "x".repeat(4_000_000),
        provider: { endpointId: "provider-1", model: "fast-planner" },
        usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
      },
    });

    expect(projected?.data).toEqual({
      text: "",
      provider: { endpointId: "provider-1", model: "fast-planner" },
      usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
    });
    expect(JSON.stringify(projected).length).toBeLessThan(1_000);
  });

  test("preserves localized run failures for history replay", () => {
    const projected = projectAgentRunEventForHistory({
      channel: AgentEventChannels.AgentEvent,
      kind: AgentEventKinds.RunFailed,
      layer: AgentEventLayers.Error,
      phase: AgentEventPhases.Run,
      sequence: 2,
      timestamp: "2026-07-17T00:00:01.000Z",
      sessionId: "session-1",
      requestId: "request-1",
      data: {
        ...projectAgentMessage("config.providerEndpointMissing", { providerId: "custom" }),
        code: "provider_endpoint_missing",
        details: { largeDiagnostic: "x".repeat(10_000) },
      },
    });

    expect(projected?.data).toEqual({
      message: "供应商端点配置不存在：ProviderId=custom",
      code: "provider_endpoint_missing",
      localizedMessage: {
        key: "config.providerEndpointMissing",
        params: { providerId: "custom" },
        text: {
          "zh-CN": "供应商端点配置不存在：ProviderId=custom",
          "en-US": "The provider endpoint does not exist: ProviderId=custom",
        },
      },
    });
  });

  test("persists scoped child-run lifecycle and snapshot events for refresh recovery", () => {
    const projected = projectAgentRunEventForHistory({
      eventId: "event-child-snapshot",
      channel: AgentEventChannels.AgentEvent,
      kind: AgentEventKinds.ChildRunSnapshotUpdated,
      layer: AgentEventLayers.Snapshot,
      phase: AgentEventPhases.Orchestration,
      sequence: 3,
      timestamp: "2026-07-17T00:00:02.000Z",
      sessionId: "parent-session",
      requestId: "parent-request",
      scope: {
        parentSessionId: "parent-session",
        parentRequestId: "parent-request",
        childRunId: "child-run-1",
        agentName: "reviewer",
        role: "childAgent",
      },
      data: {
        childRunId: "child-run-1",
        childSessionId: "child-session-1",
        agentName: "reviewer",
        status: "running",
        checkpointAvailable: true,
        snapshot: { lastActivityAt: "2026-07-17T00:00:02.000Z", activeTools: ["WorkspaceRead"] },
      },
    });

    expect(projected).toMatchObject({
      eventId: "event-child-snapshot",
      phase: AgentEventPhases.Orchestration,
      sessionId: "parent-session",
      requestId: "parent-request",
      scope: { childRunId: "child-run-1", role: "childAgent" },
      data: { checkpointAvailable: true },
    });
  });

  test("persists native MemOS context snapshots for refresh recovery", () => {
    const projected = projectAgentRunEventForHistory({
      eventId: "event-memos",
      channel: AgentEventChannels.AgentEvent,
      kind: AgentEventKinds.ContinuitySnapshot,
      layer: AgentEventLayers.Snapshot,
      phase: AgentEventPhases.Prompt,
      sequence: 4,
      timestamp: "2026-10-08T01:00:03.000Z",
      sessionId: "session-1",
      requestId: "request-1",
      data: {
        enabled: true,
        periodDigests: [],
        eventCandidates: [{ uri: "memos:one", summary: "用户喜欢牛肉。" }],
        selection: {},
      },
    });
    expect(projected).toMatchObject({
      kind: AgentEventKinds.ContinuitySnapshot,
      data: { eventCandidates: [{ uri: "memos:one", summary: "用户喜欢牛肉。" }] },
    });
  });
});
