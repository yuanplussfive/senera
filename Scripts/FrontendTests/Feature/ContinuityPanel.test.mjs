import React from "react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";
import { installMemoryLocalStorage, resetFrontendStore } from "../frontendStoreTestHarness.mjs";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { ContinuityPanel } from "../../../Frontend/src/features/continuity/ContinuityPanel.tsx";
import { useStore } from "../../../Frontend/src/store/sessionStore.ts";
import { frontendFeatureMessage as frontendMessage } from "../../../Frontend/src/i18n/frontendFeatureMessageCatalog.ts";

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
  return renderWithFrontendProviders(React.createElement(ContinuityPanel));
}
test("shows related memory retention and keeps frozen and updated versions independently selectable", () => {
  const frozen = {
    id: "preference",
    uri: "memos:preference",
    revision: "v1",
    type: "preference",
    summary: "Prefers short replies",
    occurredAt: "2026-10-27T00:00:00Z",
    score: 0.5,
    matchedBy: ["global_preference"],
    retention: { days: 0, confirmedAt: "2026-10-27T00:00:00Z" },
  };
  const updated = {
    ...frozen,
    revision: "v2",
    summary: "Prefers short replies with examples",
    score: 0.8,
    matchedBy: ["related_knowledge"],
  };
  ingest(EventKinds.RunStarted, { input: "Reply with examples" });
  ingest(
    EventKinds.ContinuitySnapshot,
    {
      enabled: true,
      eventCandidates: [frozen],
      relatedCandidates: [updated],
      selection: {
        events: { available: 1, matched: 1, selected: 1 },
        related: { available: 1, matched: 1, selected: 1 },
        usedTokens: 120,
        maxTokens: 2048,
      },
    },
    2,
  );
  renderPanel();
  expect(screen.getByText(updated.summary)).toBeVisible();
  const rows = document.querySelectorAll('[data-continuity-record="memos:preference"]');
  expect(rows).toHaveLength(2);
  fireEvent.click(within(rows[1]).getByRole("button"));
  expect(within(rows[1]).getByText(frontendMessage("continuity.retention.permanent"))).toBeVisible();
  expect(within(rows[0]).getByRole("button")).toHaveAttribute("aria-expanded", "false");
  expect(within(rows[1]).getByRole("button")).toHaveAttribute("aria-expanded", "true");
});
test("shows task memories and attribution diagnostics from the current contract", async () => {
  ingest(EventKinds.RunStarted, { input: "继续排查" });
  ingest(
    EventKinds.ContinuitySnapshot,
    {
      enabled: true,
      query: "继续排查",
      snapshotGeneration: 1,
      metrics: { ranking: { count: 1, average: 0.8, max: 0.8 }, relevance: { count: 1, average: 0.9, max: 0.9 } },
      eventCandidates: [],
      taskCandidates: [
        {
          id: "task",
          uri: "memos:task",
          revision: "v1",
          type: "context",
          summary: "已定位的关键原因",
          occurredAt: "2026-10-27T00:00:00Z",
          score: 0.8,
          matchedBy: ["task"],
          scores: { relevance: 0.9, recency: 1 },
          quality: {
            weight: 50,
            recallCount: 2,
            helpfulCount: 0,
            unhelpfulCount: 0,
            unusedCount: 1,
            uncertainCount: 0,
            pendingCount: 1,
          },
        },
      ],
      diagnostics: {
        unassigned: 3,
        otherSubject: 1,
        irrelevant: 2,
        snapshotReused: false,
        relevanceStatus: "completed",
      },
      selection: {
        events: { available: 2, matched: 0, selected: 0 },
        tasks: { available: 1, matched: 1, selected: 1 },
        usedTokens: 100,
        maxTokens: 2048,
      },
    },
    2,
  );
  renderPanel();
  expect(screen.queryByTestId("continuity-empty")).not.toBeInTheDocument();
  expect(screen.getByText("已定位的关键原因")).toBeVisible();
  fireEvent.click(screen.getByText(frontendMessage("insights.memory.audit")));
  expect(await screen.findByText(frontendMessage("continuity.diagnostics.unassigned", { count: 3 }))).toBeVisible();
  const record = document.querySelector('[data-continuity-record="memos:task"]');
  fireEvent.click(within(record).getByRole("button", { name: /已定位/ }));
  fireEvent.click(within(record).getByText(frontendMessage("continuity.recordDetails")));
  expect(within(record).getByText(frontendMessage("continuity.recallAudit.recency"))).toBeVisible();
  expect(record.querySelector(".continuity-memory-table__recallCount")).toHaveTextContent("2");
});
test("displays grouped native knowledge and separates memory budget from model context", async () => {
  ingest(EventKinds.RunStarted, { input: "偏好" });
  ingest(
    EventKinds.ContinuitySnapshot,
    {
      enabled: true,
      query: "偏好",
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
        events: { available: 1, matched: 1, selected: 1 },
        usedTokens: 24,
        maxTokens: 2048,
      },
    },
    2,
  );
  renderPanel();
  expect(screen.getByText("先给结论。")).toBeVisible();
  const record = document.querySelector('[data-continuity-record="memos:1"]');
  expect(document.querySelector("[data-continuity-budget]")).toBeVisible();
  expect(document.querySelector("[data-continuity-composition] svg")).toBeVisible();
  expect(document.querySelector('[data-continuity-group="task"]')).not.toBeInTheDocument();
  expect(record.closest("section").querySelector(".insights-count")).toHaveTextContent("1");
  fireEvent.click(screen.getByText(frontendMessage("insights.memory.audit")));
  await screen.findByText("偏好", { selector: ".continuity-query q" });
  expect(screen.getByText("24", { selector: ".continuity-budget__line > span" })).toBeVisible();
  expect(screen.getByText(/2,?048/, { selector: ".continuity-budget__line > span" })).toBeVisible();
  expect(screen.queryAllByRole("tab")).toHaveLength(0);
  const row = within(record).getByRole("button", { name: /先给结论/ });
  fireEvent.click(row);
  expect(row).toHaveAttribute("aria-expanded", "true");
  expect(record.querySelector("time")).toHaveAttribute("datetime", "2026-08-22T08:00:00Z");
  expect(within(record).getAllByText("先给结论。")).toHaveLength(1);
  fireEvent.click(within(record).getByText(frontendMessage("continuity.recordDetails")));
  expect(within(record).getByText("0.82")).toBeVisible();
  expect(within(record).queryByText("memos:1")).not.toBeInTheDocument();
});
test("uses host score summaries and does not invent relevance for global preferences", () => {
  ingest(EventKinds.RunStarted, { input: "你好" });
  ingest(
    EventKinds.ContinuitySnapshot,
    {
      enabled: true,
      eventCandidates: [
        {
          id: "fish",
          uri: "senera://resource/Ab12cd",
          revision: "v1",
          type: "preference",
          summary: "用户喜欢吃鱼。",
          occurredAt: "2026-10-27T00:00:00Z",
          score: 0.5,
          matchedBy: ["memos", "global_preference"],
          quality: {
            weight: 50,
            recallCount: 0,
            helpfulCount: 0,
            unhelpfulCount: 0,
            unusedCount: 0,
            uncertainCount: 0,
            pendingCount: 0,
          },
        },
      ],
      metrics: { ranking: { count: 1, average: 0.5, max: 0.5 }, relevance: { count: 0 } },
      selection: { events: { available: 1, matched: 1, selected: 1 }, usedTokens: 229, maxTokens: 16384 },
    },
    2,
  );
  renderPanel();
  const record = document.querySelector('[data-continuity-record="senera://resource/Ab12cd"]');
  fireEvent.click(within(record).getByRole("button", { name: /用户喜欢吃鱼/ }));
  expect(record).not.toHaveTextContent("senera://");
  expect(record.querySelector(".continuity-candidate__score")).toHaveTextContent("0.5");
  expect(record.querySelector(".continuity-memory-table__weight")).toHaveAttribute(
    "title",
    frontendMessage("continuity.recallAudit.weightedScore"),
  );
  expect(within(record).getByText(frontendMessage("continuity.recallAudit.globalPreference"))).toBeVisible();
  expect(within(record).getByText("50%")).toBeVisible();
  expect(within(record).queryByText(frontendMessage("continuity.recallAudit.relevance"))).not.toBeInTheDocument();
});

test("shows unavailable summary for historical snapshots instead of scoring them in the browser", () => {
  ingest(EventKinds.RunStarted, { input: "历史" });
  ingest(
    EventKinds.ContinuitySnapshot,
    {
      enabled: true,
      eventCandidates: [
        {
          id: "fact",
          uri: "senera://resource/old123",
          revision: "v1",
          type: "fact",
          summary: "历史事实",
          occurredAt: "2026-10-27T00:00:00Z",
          score: 0.2,
          matchedBy: ["memos"],
          scores: { relevance: 0.9 },
        },
      ],
      selection: { events: { available: 1, matched: 1, selected: 1 }, usedTokens: 100, maxTokens: 2048 },
    },
    2,
  );
  renderPanel();
  const record = document.querySelector('[data-continuity-record="senera://resource/old123"]');
  expect(record.querySelector(".continuity-memory-table__weight")).toHaveTextContent("—");
  fireEvent.click(within(record).getByRole("button"));
  fireEvent.click(within(record).getByText(frontendMessage("continuity.recordDetails")));
  expect(record.querySelector(".continuity-candidate__score")).toHaveTextContent("0.2");
  expect(screen.queryByText(frontendMessage("continuity.quality.title"))).not.toBeInTheDocument();
});
test("does not borrow memory from a different run without a snapshot", () => {
  ingest(EventKinds.RunStarted, { input: "之前" }, 1, "old");
  ingest(
    EventKinds.ContinuitySnapshot,
    {
      enabled: true,
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
