import React from "react";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";
import { EventKinds, EventSpecs } from "../../../Frontend/src/api/generatedEventCatalog.ts";
import { RuntimeDiagnosticPanel } from "../../../Frontend/src/features/observability/RuntimeDiagnosticPanel.tsx";
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

test("shows a time-scaled diagnostic waterfall without rendering workflow nodes", async () => {
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
  expect(document.querySelector("[data-runtime-terminal-stream]")).toBeVisible();
  expect(document.querySelector('[data-runtime-lane="model"]')).not.toBeInTheDocument();
  expect(document.querySelector('[data-runtime-lane="tools"]')).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /search/ })).toBeVisible();
  expect(screen.getByRole("region", { name: "运行记录" })).toBeVisible();
  expect(document.querySelectorAll("[data-runtime-span]")).toHaveLength(2);
  expect(document.querySelectorAll("[data-node-id]")).toHaveLength(0);

  await userEvent.click(screen.getByRole("button", { name: /search/ }));
  expect(document.querySelector("[data-runtime-span-detail]")).toBeVisible();
  expect(document.querySelectorAll("[data-runtime-span-detail]")).toHaveLength(1);
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
