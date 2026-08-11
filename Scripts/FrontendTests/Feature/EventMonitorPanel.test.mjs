import React from "react";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";
import { EventMonitorPanel } from "../../../Frontend/src/features/observability/EventMonitorPanel.tsx";
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

test("event monitor displays live transport records and structured safe detail", async () => {
  useEventJournalStore.getState().append([
    {
      connectionId: "ws-1",
      observedAt: "2026-08-04T00:00:00.000Z",
      direction: "outbound",
      stage: "command",
      requestType: "session.message",
      correlation: { sessionId: "session-1", requestId: "request-1" },
      byteLength: 128,
    },
    {
      connectionId: "ws-1",
      observedAt: "2026-08-04T00:00:01.000Z",
      direction: "inbound",
      stage: "projected",
      envelope: {
        eventId: "event-1",
        channel: "agent.event",
        kind: "run.activity.changed",
        layer: "progress",
        phase: "run",
        sequence: 1,
        timestamp: "2026-08-04T00:00:01.000Z",
        sessionId: "session-1",
        requestId: "request-1",
        step: 1,
        data: {
          activityId: "activity-1",
          activity: "preparing_context",
          state: "started",
          startedAt: "2026-08-04T00:00:01.000Z",
        },
      },
    },
  ]);

  renderWithFrontendProviders(React.createElement(EventMonitorPanel));
  expect(screen.getByText("session.message")).toBeVisible();
  expect(screen.getByText("run.activity.changed")).toBeVisible();

  await userEvent.click(screen.getByText("run.activity.changed"));
  expect(screen.getByLabelText("事件结构详情")).toBeVisible();
  expect(screen.getByLabelText("事件结构详情")).toHaveTextContent("activity-1");

  await userEvent.click(screen.getByRole("button", { name: "暂停视图" }));
  expect(screen.getByRole("button", { name: "继续视图" })).toBeVisible();
  await userEvent.click(screen.getByRole("switch", { name: "记录原始传输帧元数据" }));
  expect(screen.getByRole("switch", { name: "记录原始传输帧元数据" })).toHaveAttribute("aria-checked", "true");
});

test("event monitor keeps recording control separate from clearing retained events", async () => {
  useEventJournalStore.getState().append([
    {
      connectionId: "ws-1",
      observedAt: "2026-08-04T00:00:00.000Z",
      direction: "system",
      stage: "lifecycle",
      state: "open",
    },
  ]);
  renderWithFrontendProviders(React.createElement(EventMonitorPanel));

  await userEvent.click(screen.getByRole("button", { name: "停止记录" }));
  expect(screen.getByText(/已停止记录/)).toBeVisible();
  expect(screen.getByText("socket.open")).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "清空事件" }));
  expect(screen.getByText("等待运行事件")).toBeVisible();
});
