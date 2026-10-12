import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";
import { installMemoryLocalStorage, resetFrontendStore } from "../frontendStoreTestHarness.mjs";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { ContinuityPanel } from "../../../Frontend/src/features/continuity/ContinuityPanel.tsx";
import { useStore } from "../../../Frontend/src/store/sessionStore.ts";

beforeEach(() => {
  installMemoryLocalStorage();
  resetFrontendStore();
});
afterEach(cleanup);
function ingest(kind, data, sequence = 1, requestId = "request") {
  useStore.getState().ingest({
    channel: "agent.event",
    kind,
    layer: kind === EventKinds.ContinuitySnapshot ? "snapshot" : "progress",
    phase: kind === EventKinds.ContinuitySnapshot ? "prompt" : "run",
    sequence,
    timestamp: "2026-08-22T08:00:00Z",
    sessionId: "session",
    requestId,
    data,
  });
}
function renderPanel() {
  useStore.setState({ activeSessionId: "session" });
  return renderWithFrontendProviders(
    React.createElement(ContinuityPanel, { send: vi.fn(() => true), connected: true }),
  );
}
test("displays the selected native knowledge and budget without obsolete tabs", () => {
  ingest(EventKinds.RunStarted, { input: "偏好" });
  ingest(
    EventKinds.ContinuitySnapshot,
    {
      enabled: true,
      query: "偏好",
      periodDigests: [],
      eventCandidates: [
        {
          id: "1",
          uri: "memos:1",
          revision: "v1",
          type: "preference",
          summary: "先给结论。",
          occurredAt: "2026-08-22T08:00:00Z",
          score: 0.91,
          matchedBy: ["memos", "keyword", "semantic", "hybrid"],
          scores: { keyword: 0.72, semantic: 0.91, hybrid: 0.82 },
        },
      ],
      selection: {
        digests: { available: 0, matched: 0, selected: 0 },
        events: { available: 1, matched: 1, selected: 1 },
        usedTokens: 24,
        maxTokens: 2048,
      },
    },
    2,
  );
  renderPanel();
  expect(screen.getByText("先给结论。")).toBeVisible();
  expect(screen.getByText("检索：偏好")).toBeVisible();
  expect(screen.getByText("24 / 2048 tokens")).toBeVisible();
  expect(screen.getAllByRole("tab")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: /先给结论/ }));
  expect(screen.getByText("综合 82%")).toBeVisible();
  expect(screen.getByText("来源：memos:1")).toBeVisible();
  fireEvent.click(screen.getByRole("tab", { name: "记忆" }));
  expect(screen.getByText("先给结论。")).toBeVisible();
  expect(screen.queryByText("条件")).not.toBeInTheDocument();
});
test("does not borrow memory from a different run without a snapshot", () => {
  ingest(EventKinds.RunStarted, { input: "之前" }, 1, "old");
  ingest(
    EventKinds.ContinuitySnapshot,
    {
      enabled: true,
      periodDigests: [],
      eventCandidates: [
        {
          id: "1",
          uri: "memos:1",
          revision: "v1",
          type: "preference",
          summary: "先给结论。",
          occurredAt: "2026-08-22T08:00:00Z",
          score: 0.91,
          matchedBy: ["memos"],
        },
      ],
      selection: {
        digests: { available: 0, matched: 0, selected: 0 },
        events: { available: 1, matched: 1, selected: 1 },
        usedTokens: 24,
        maxTokens: 2048,
      },
    },
    2,
    "old",
  );
  ingest(EventKinds.RunStarted, { input: "现在" }, 3, "new");
  renderPanel();
  expect(screen.getByTestId("continuity-empty")).toBeVisible();
  expect(screen.queryByText("先给结论。")).not.toBeInTheDocument();
});
