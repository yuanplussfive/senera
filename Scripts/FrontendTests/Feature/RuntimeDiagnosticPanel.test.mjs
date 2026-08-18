import React from "react";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";
import { EventKinds, EventSpecs } from "../../../Frontend/src/api/generatedEventCatalog.ts";
import { RuntimeDiagnosticPanel } from "../../../Frontend/src/features/observability/RuntimeDiagnosticPanel.tsx";
import { projectRuntimeDiagnosticFromRun } from "../../../Frontend/src/features/observability/runtimeDiagnosticProjection.ts";
import { useEventJournalStore } from "../../../Frontend/src/features/observability/eventJournalStore.ts";

beforeEach(() => {
  useEventJournalStore.setState({
    records: [],
    totalBytes: 0,
    recording: true,
    wireCapture: false,
    viewPausedAt: undefined,
    selectedId: undefined,
  });
});

afterEach(() => cleanup());

test("shows a time-scaled turn trajectory without rendering workflow nodes", async () => {
  useEventJournalStore.setState({
    records: [
      projected(EventKinds.RunActivityChanged, 1, {
        activityId: "activity-1",
        activity: "running_agent_turn",
        state: "completed",
        startedAt: "2026-08-04T00:00:00.000Z",
        durationMs: 1200,
      }),
      projected(EventKinds.ToolCallStarted, 2, {
        index: 0,
        toolName: "search",
        callId: "call-1",
        startedAt: "2026-08-04T00:00:00.200Z",
      }),
      projected(EventKinds.ToolCallCompleted, 3, {
        index: 0,
        toolName: "search",
        callId: "call-1",
        startedAt: "2026-08-04T00:00:00.200Z",
        durationMs: 400,
      }),
    ],
    totalBytes: 384,
  });

  renderWithFrontendProviders(React.createElement(RuntimeDiagnosticPanel));

  expect(screen.getByRole("heading", { name: "Senera 运行状态" })).toBeVisible();
  expect(screen.getByRole("region", { name: "运行控制台" })).toBeVisible();
  expect(screen.getByRole("region", { name: "时间概览" })).toBeVisible();
  expect(document.querySelector("[data-runtime-terminal-stream]")).toBeVisible();
  expect(document.querySelector("[data-runtime-trajectory-overview]")).toBeVisible();
  expect(document.querySelector('[data-runtime-lane="model"]')).not.toBeInTheDocument();
  expect(document.querySelector('[data-runtime-lane="tools"]')).not.toBeInTheDocument();
  expect(screen.getByText("事件")).toBeVisible();
  expect(screen.getByText("内容")).toBeVisible();
  expect(screen.getByRole("button", { name: /search/ })).toBeVisible();
  expect(screen.getByRole("region", { name: "运行记录" })).toBeVisible();
  expect(document.querySelectorAll("[data-runtime-span]")).toHaveLength(2);
  expect(document.querySelectorAll("[data-node-id]")).toHaveLength(0);

  await userEvent.click(screen.getByRole("button", { name: /search/ }));
  expect(document.querySelector("[data-runtime-span-detail]")).toBeVisible();
  expect(document.querySelectorAll("[data-runtime-span-detail]")).toHaveLength(1);
});

test("rebuilds a completed historical run from the durable run projection", () => {
  const model = projectRuntimeDiagnosticFromRun(
    {
      requestId: "request-history",
      revision: 2,
      startedAt: "2026-08-04T00:00:00.000Z",
      endedAt: "2026-08-04T00:00:02.000Z",
      status: "completed",
      outputState: "committed",
      input: "读取项目",
      activities: [],
      steps: [
        {
          id: "understand",
          kind: "understand",
          title: "理解请求",
          status: "done",
          startedAt: "2026-08-04T00:00:00.000Z",
          endedAt: "2026-08-04T00:00:00.100Z",
        },
        {
          id: "planned-tool",
          kind: "tool",
          title: "读取文件",
          status: "pending",
          startedAt: "2026-08-04T00:00:00.200Z",
          toolName: "WorkspaceRead",
        },
        {
          id: "tool-1",
          kind: "tool",
          title: "读取文件",
          status: "done",
          startedAt: "2026-08-04T00:00:00.200Z",
          endedAt: "2026-08-04T00:00:01.000Z",
          durationMs: 800,
          toolName: "WorkspaceRead",
          callId: "call-1",
        },
        {
          id: "answer",
          kind: "answer",
          title: "生成回复",
          status: "done",
          startedAt: "2026-08-04T00:00:01.100Z",
          endedAt: "2026-08-04T00:00:02.000Z",
        },
      ],
      streamingRaw: "",
      xmlPreview: "",
      visibleText: "",
      displayText: "",
      visibleKind: "final_answer",
      expectedOutputMode: "final_text",
      decisionMode: "final_text",
    },
    { nowEpoch: Date.parse("2026-08-04T00:00:02.000Z") },
  );

  expect(model.requestId).toBe("request-history");
  expect(model.spans.map((span) => span.id)).toEqual([
    "run:request-history:understand",
    "run:request-history:tool-1",
    "run:request-history:answer",
  ]);
  expect(model.spans.every((span) => span.status !== "running")).toBe(true);
});

function projected(kind, sequence, data) {
  const timestamp = "2026-08-04T00:00:00.000Z";
  return {
    id: `journal-${sequence}`,
    localSequence: sequence,
    connectionId: "ws-1",
    observedAt: timestamp,
    observedAtEpoch: Date.parse(timestamp),
    direction: "inbound",
    stage: "projected",
    kind,
    layer: EventSpecs[kind].layer,
    phase: EventSpecs[kind].phase,
    sequence,
    sessionId: "session-1",
    requestId: "request-1",
    step: 1,
    retainedByteLength: 128,
    projection: { data },
    projectionOmitted: false,
  };
}
