import { describe, expect, it } from "vitest";
import {
  EventKinds,
  EventLayers,
  EventPhases,
  type EventEnvelope,
} from "../api/eventTypes";
import {
  resolveSocketErrorToast,
  type SocketErrorToastState,
} from "./useSocketErrorToasts";

const baseState: SocketErrorToastState = {
  historyLoadingIds: {},
  sessions: {},
};

function event(kind: EventEnvelope["kind"], overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    channel: "agent.event",
    kind,
    layer: EventLayers.Error,
    phase: EventPhases.Run,
    sequence: 1,
    timestamp: "2026-06-08T00:00:00.000Z",
    data: {},
    ...overrides,
  };
}

describe("resolveSocketErrorToast", () => {
  it("routes run failures during history loading without a matching run to the history toast", () => {
    expect(resolveSocketErrorToast(event(EventKinds.RunFailed, {
      sessionId: "session-a",
      requestId: "request-a",
      data: { message: "history broke" },
    }), {
      historyLoadingIds: { "session-a": true },
      sessions: {
        "session-a": { runs: [{ requestId: "other-request" }] },
      },
    })).toEqual({
      variant: "error",
      title: "历史同步失败",
      description: "history broke",
    });
  });

  it("routes run failures with a matching run to the normal run failure toast", () => {
    expect(resolveSocketErrorToast(event(EventKinds.RunFailed, {
      sessionId: "session-a",
      requestId: "request-a",
      data: { message: "run broke" },
    }), {
      historyLoadingIds: { "session-a": true },
      sessions: {
        "session-a": { runs: [{ requestId: "request-a" }] },
      },
    })).toEqual({
      variant: "error",
      title: "运行失败",
      description: "run broke",
    });
  });

  it("routes busy session events to a warning toast", () => {
    expect(resolveSocketErrorToast(event(EventKinds.SessionBusy), baseState)).toEqual({
      variant: "warning",
      title: "会话正忙，请等待当前请求结束",
    });
  });

  it("keeps tool failure details in the toast title and description", () => {
    expect(resolveSocketErrorToast(event(EventKinds.ToolCallFailed, {
      data: { toolName: "search", message: "timeout" },
    }), baseState)).toEqual({
      variant: "error",
      title: "工具调用失败: search",
      description: "timeout",
    });
  });

  it("routes invalid requests to a request-format toast", () => {
    expect(resolveSocketErrorToast(event(EventKinds.RequestInvalid, {
      data: { message: "missing sessionId" },
    }), baseState)).toEqual({
      variant: "error",
      title: "请求格式错误",
      description: "missing sessionId",
    });
  });

  it("ignores non-error-toast socket events", () => {
    expect(resolveSocketErrorToast(event(EventKinds.ModelDelta), baseState)).toBeNull();
  });
});
