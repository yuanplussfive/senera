import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";
import { installMemoryLocalStorage, resetFrontendStore } from "../frontendStoreTestHarness.mjs";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { useStore } from "../../../Frontend/src/store/sessionStore.ts";
import { SessionInsightsPanel } from "../../../Frontend/src/features/observability/SessionInsightsPanel.tsx";
import { ContinuityPanel } from "../../../Frontend/src/features/continuity/ContinuityPanel.tsx";
import {
  ContextInspectionView,
  createContextInspectionState,
} from "../../../Frontend/src/features/observability/ContextInspectionView.tsx";
import { WorkspaceResourceProvider } from "../../../Frontend/src/shared/workspace/WorkspaceResourceProvider.tsx";
import * as WorkspaceResources from "../../../Frontend/src/shared/workspace/WorkspaceResourceProvider.tsx";
import {
  contextChanges,
  contextComposition,
  requestContextUsageDelta,
} from "../../../Frontend/src/features/observability/contextInspectionModel.ts";
import {
  inspectionScopes,
  inspectionScopeId,
  inspectionUsage,
} from "../../../Frontend/src/features/observability/inspectionScopeModel.ts";
import { projectRunHistoryDiagnostics } from "../../../Frontend/src/store/session/runHistoryDetailProjection.ts";
import { frontendFeatureMessage as t } from "../../../Frontend/src/i18n/frontendFeatureMessageCatalog.ts";

beforeEach(() => {
  installMemoryLocalStorage();
  resetFrontendStore();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const section = {
  id: "system-hash",
  category: "system",
  label: "system",
  tokens: 60,
  characters: 120,
  images: 0,
  resourceUri: "senera://resource/Ab12cd",
};
const snapshot = {
  format: "pi-input/v1",
  scope: "native",
  measurement: "local_estimate",
  contextWindow: 1000,
  reserveTokens: 100,
  estimatedTokens: 60,
  sections: [section],
};
let sequence = 0;
function ingest(kind, data, requestId = "old") {
  useStore.getState().ingest({
    channel: "agent.event",
    kind,
    layer: "progress",
    phase: "model",
    sequence: ++sequence,
    timestamp: "2026-10-29T00:00:00Z",
    sessionId: "session",
    requestId,
    step: 1,
    data,
  });
}
function seed() {
  sequence = 0;
  ingest(EventKinds.RunStarted, { input: "Earlier task" });
  ingest(EventKinds.ModelStarted, { model: "earlier-model", messageIndex: 0, contextSnapshot: snapshot });
  ingest(EventKinds.ModelCompleted, {
    text: "",
    messageIndex: 0,
    outcome: "failed",
    errorMessage: "Request failed",
    usage: { source: "provider_reported", inputTokens: 80, cacheReadTokens: 20, outputTokens: 7, totalTokens: 107 },
  });
  useStore.setState({ activeSessionId: "session" });
}
function renderPanel(props) {
  return renderWithFrontendProviders(
    React.createElement(
      WorkspaceResourceProvider,
      { httpBaseUrl: "http://backend.test" },
      React.createElement(SessionInsightsPanel, { initialView: "process", ...props }),
    ),
  );
}
function renderContinuityPanel() {
  return renderWithFrontendProviders(React.createElement(ContinuityPanel));
}

function contentResponse(content) {
  return new Response(
    JSON.stringify({
      ok: true,
      resource: {
        path: section.resourceUri,
        name: "context.txt",
        mime: "text/plain",
        kind: "text",
        size: content.length,
        editable: false,
        etag: "etag",
        content,
      },
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}

async function selectOption(label, option, index = 0) {
  fireEvent.keyDown(screen.getByRole("button", { name: new RegExp(`^${label}:`) }), { key: "Enter" });
  fireEvent.click((await screen.findAllByRole("menuitemradio", { name: option }))[index]);
}

function selectTab(view) {
  fireEvent.mouseDown(screen.getByRole("tab", { name: t(`insights.tab.${view}`) }), { button: 0, ctrlKey: false });
}

function seedChildren() {
  seed();
  const run = structuredClone(useStore.getState().sessions.session.runs[0]);
  run.usage = { source: "provider_reported", totalTokens: 999, cost: { currency: "USD", total: 1 } };
  for (const [index, childRunId] of ["child-a", "child-b"].entries()) {
    const envelope = {
      channel: "agent.event",
      sessionId: "session",
      requestId: `${childRunId}-request`,
      scope: { parentRequestId: "old", childRunId, agentName: "Research", role: "childAgent" },
      step: 1,
      timestamp: "2026-10-29T00:00:00Z",
    };
    projectRunHistoryDiagnostics(useStore.getState(), run, [
      {
        ...envelope,
        kind: EventKinds.ModelStarted,
        sequence: 10 + index * 2,
        data: { model: `${childRunId}-model`, messageIndex: 0, contextSnapshot: snapshot },
      },
      {
        ...envelope,
        kind: EventKinds.ModelCompleted,
        sequence: 11 + index * 2,
        data: {
          messageIndex: 0,
          outcome: "completed",
          usage: { source: "provider_reported", totalTokens: 20 + index, cost: { currency: "USD", total: 0.01 } },
        },
      },
    ]);
  }
  useStore.setState((state) => ({
    sessions: { ...state.sessions, session: { ...state.sessions.session, runs: [run] } },
  }));
  return run;
}

test("same-named Agents remain distinct and process and context use the same selected scope", async () => {
  const run = seedChildren();
  expect(inspectionScopes(run)).toHaveLength(3);
  renderPanel();
  await selectOption(t("insights.agent.select"), "Research", 1);
  expect(document.querySelectorAll("[data-inspection-step]")).toHaveLength(1);
  expect(within(document.querySelector("[data-execution-inspection]")).getByText("child-b-model")).toBeVisible();
  expect(
    within(document.querySelector("[data-execution-inspection]")).queryByText("child-a-model"),
  ).not.toBeInTheDocument();
  const metrics = document.querySelector(".insights-facts");
  expect(within(metrics).getByText("21")).toBeVisible();
  expect(within(metrics).queryByText("999")).not.toBeInTheDocument();
  selectTab("context");
  expect(document.querySelectorAll(".insights-request-trend > button")).toHaveLength(1);
  expect(document.querySelector(".insights-section-title > span")).toHaveTextContent("child-b-model");
});

test("partial Agent meters stay unknown while whole-turn totals remain independent", () => {
  const run = structuredClone(seedChildren());
  const child = run.steps.find((step) => step.scope?.childRunId === "child-a");
  const scopeId = inspectionScopeId(child.scope);
  run.steps.push({ ...child, id: "pending-request", modelUsage: undefined });
  expect(inspectionUsage(run, scopeId)).toEqual({ tokens: undefined, cost: undefined });
  expect(inspectionUsage(run)).toEqual({ tokens: 999, cost: 1 });
});

test("asynchronous content preserves search and remains open across tabs and expansion without refetching", async () => {
  seed();
  let resolve;
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  renderPanel({ initialView: "context" });
  fireEvent.click(within(document.querySelector(".insights-context-entry")).getByRole("button"));
  const search = () => screen.getByRole("textbox", { name: t("insights.context.search") });
  fireEvent.change(search(), { target: { value: "system" } });
  await act(async () => resolve(contentResponse("Prepared content stays visible")));
  expect(search()).toHaveValue("system");
  expect(await screen.findByText("Prepared content stays visible")).toBeVisible();
  selectTab("process");
  selectTab("context");
  fireEvent.click(screen.getByRole("button", { name: t("continuity.expand") }));
  expect(search()).toHaveValue("system");
  await waitFor(() => expect(screen.getByText("Prepared content stays visible")).toBeVisible());
  fireEvent.click(screen.getByRole("button", { name: t("continuity.collapse") }));
  await waitFor(() =>
    expect(
      screen.getAllByText("Prepared content stays visible").some((element) => !element.closest('[role="dialog"]')),
    ).toBe(true),
  );
  expect(fetch.mock.calls.filter(([url]) => !String(url).includes("/api/session/insights"))).toHaveLength(1);
});

test("copy and viewer actions use the loaded content and its exact resource identity", async () => {
  seed();
  const copy = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
  const openResource = vi.fn();
  vi.spyOn(WorkspaceResources, "useWorkspaceResourceController").mockReturnValue({
    httpBaseUrl: "http://backend.test",
    openResource,
  });
  vi.spyOn(globalThis, "fetch").mockResolvedValue(contentResponse("Exact content to copy"));
  renderPanel({ initialView: "context" });
  fireEvent.click(within(document.querySelector(".insights-context-entry")).getByRole("button"));
  expect(await screen.findByText("Exact content to copy")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: t("insights.context.copyContent") }));
  await waitFor(() => expect(copy).toHaveBeenCalledWith("Exact content to copy"));
  fireEvent.click(screen.getByRole("button", { name: t("insights.context.openContent") }));
  expect(openResource).toHaveBeenCalledWith({ path: section.resourceUri });
});

test("added-only content preserves the multiset difference between successive requests", async () => {
  seed();
  const categories = ["thinking", "preface", "assistant", "toolCall", "toolResult"];
  const semantic = categories.map((category) => ({ ...section, id: category, category, label: "Read" }));
  const repeated = { ...snapshot, sections: [section, section, ...semantic] };
  ingest(EventKinds.ModelStarted, { messageIndex: 1, model: "model", contextSnapshot: repeated });
  renderPanel({ initialView: "context" });
  expect(document.querySelectorAll(".insights-context-entry")).toHaveLength(7);
  for (const category of categories) {
    const entry = document.querySelector(`.insights-context-entry[data-category="${category}"]`);
    expect(within(entry).getByText(t(`insights.context.${category}`))).toBeVisible();
    expect(contextComposition(repeated).find((part) => part.id === category)).toMatchObject({ count: 1, tokens: 60 });
  }
  const search = screen.getByRole("textbox", { name: t("insights.context.search") });
  fireEvent.change(search, { target: { value: t("insights.context.toolCall") } });
  await waitFor(() => expect(document.querySelectorAll(".insights-context-entry")).toHaveLength(1));
  expect(document.querySelector(".insights-context-entry")).toHaveAttribute("data-category", "toolCall");
  fireEvent.change(search, { target: { value: "" } });
  await waitFor(() => expect(document.querySelectorAll(".insights-context-entry")).toHaveLength(7));
  await selectOption(t("insights.context.changeFilter"), t("insights.context.addedContent"));
  const entries = document.querySelectorAll(".insights-context-entry");
  expect(entries).toHaveLength(6);
  expect(within(entries[0]).getByText("2")).toBeVisible();
});

test("loading history is distinct from no execution and no model requests", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ sessionId: "session", through: 0, events: [] }), {
      headers: { "Content-Type": "application/json" },
    }),
  );
  ingest(EventKinds.RunStarted, { input: "Loading task" });
  useStore.setState({
    activeSessionId: "session",
    runHistoryDetailStates: { session: { old: "loading" } },
  });
  renderPanel();
  expect(screen.getByRole("status")).toHaveTextContent(t("insights.historyLoading"));
  expect(document.querySelector(".insights-facts")).not.toBeInTheDocument();
  act(() => useStore.setState({ runHistoryDetailStates: {} }));
  expect(document.querySelector('[data-inspection-step="old-understand"]')).not.toBeInTheDocument();
  expect(screen.getByText(t("insights.process.noMatches"))).toBeVisible();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  selectTab("context");
  await waitFor(() =>
    expect(screen.getByText(t("insights.context.noRequests"), { selector: "p.insights-empty" })).toBeVisible(),
  );
  expect(screen.queryByText(t("insights.context.historyUnavailable"))).not.toBeInTheDocument();
});

test("memory expansion and audit remain open when enlarging the panel", async () => {
  seed();
  ingest(EventKinds.ContinuitySnapshot, {
    enabled: true,
    query: "Remember",
    eventCandidates: [
      {
        id: "preference",
        uri: "memos:preference",
        revision: "v1",
        type: "preference",
        summary: "Use existing components",
        score: 0.8,
        occurredAt: "2026-10-29T00:00:00Z",
        matchedBy: ["global_preference"],
      },
    ],
    selection: { events: { available: 1, matched: 1, selected: 1 }, usedTokens: 50, maxTokens: 1000 },
  });
  renderContinuityPanel();
  fireEvent.click(within(document.querySelector("[data-continuity-record]")).getByRole("button"));
  fireEvent.click(screen.getByText(t("insights.memory.audit")));
  await waitFor(() => expect(document.querySelector(".insights-audit")).toHaveAttribute("open"));
  fireEvent.click(screen.getByRole("button", { name: t("continuity.expand") }));
  expect(within(document.querySelector("[data-continuity-record]")).getByRole("button")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(document.querySelector(".insights-audit")).toHaveAttribute("open");
});

test("historical request uses its own provider meter and automatically loads expanded content", async () => {
  seed();
  ingest(EventKinds.RunStarted, { input: "Latest task" }, "new");
  useStore.getState().setViewedRun("session", "old");
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        ok: true,
        resource: {
          path: section.resourceUri,
          name: "context.txt",
          mime: "text/plain",
          size: 15,
          kind: "text",
          editable: false,
          etag: "etag",
          content: "Actual prepared input",
        },
      }),
      { headers: { "Content-Type": "application/json" } },
    ),
  );
  renderPanel({ initialView: "context" });
  expect(document.querySelector(".insights-context-total")).toHaveTextContent("100");
  expect(document.querySelector(".insights-context-total")).toHaveTextContent("10.0%");
  expect(screen.getByText("earlier-model", { selector: ".insights-section-title > span" })).toBeVisible();
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(within(document.querySelector(".insights-context-entry")).getByRole("button"));
  expect(await screen.findByText("Actual prepared input")).toBeVisible();
  expect(fetch).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ credentials: "include", signal: expect.any(AbortSignal) }),
  );
  expect(screen.queryByRole("button", { name: "加载" })).not.toBeInTheDocument();
});

test("process links to the exact model request and keeps failure details", () => {
  seed();
  renderPanel();
  const step = document.querySelector('[data-inspection-step="old-model-1-0"]');
  expect(step).toHaveAttribute("data-status", "failed");
  fireEvent.click(within(step).getByRole("button"));
  const detail = screen.getByRole("region", { name: t("insights.process.recordDetail") });
  expect(within(detail).getByText("Request failed")).toBeVisible();
  expect(step).toHaveAttribute("data-selected", "true");
  fireEvent.click(within(detail).getByRole("button", { name: t("insights.process.inspectContext") }));
  expect(screen.getByRole("tab", { name: t("insights.tab.context") })).toHaveAttribute("aria-selected", "true");
  expect(document.querySelector(".insights-context-total")).toHaveTextContent("100");
});

test("old runs without input snapshots explicitly show unavailability", () => {
  ingest(EventKinds.RunStarted, { input: "Legacy task" });
  ingest(EventKinds.ModelStarted, { model: "legacy-model", messageIndex: 0 });
  useStore.setState({ activeSessionId: "session" });
  renderPanel({ initialView: "context" });
  expect(screen.getByText(t("insights.context.historyUnavailable"))).toBeVisible();
  expect(document.querySelector(".insights-context-total strong")).toHaveTextContent("—");
});

test("expanded view mounts only one inspection surface and preserves the selected view", async () => {
  seed();
  renderPanel({ initialView: "context" });
  fireEvent.click(screen.getByRole("button", { name: t("continuity.expand") }));
  expect(document.querySelectorAll("[data-context-inspection]")).toHaveLength(1);
  await waitFor(() => expect(screen.getByTestId("session-insights-dialog")).toBeVisible());
  expect(screen.getByRole("tab", { name: t("insights.tab.context") })).toHaveAttribute("aria-selected", "true");
});

test("content changes count repeated messages individually and retain signed token changes", () => {
  const previous = { ...snapshot, estimatedTokens: 120, sections: [section, section] };
  const current = { ...snapshot, sections: [section, { ...section, id: "new" }] };
  const changes = contextChanges(current, previous);
  expect([...changes.added]).toEqual([1]);
  expect(changes.removed).toBe(1);
  expect(requestContextUsageDelta({ contextSnapshot: current }, { contextSnapshot: previous })).toEqual({
    tokens: -60,
    source: "local_estimate",
  });
});

test("history enrichment restores request snapshots and failure without overwriting aggregate run usage", () => {
  seed();
  const run = structuredClone(useStore.getState().sessions.session.runs[0]);
  run.steps = [];
  run.usage = { source: "provider_reported", totalTokens: 999 };
  const envelope = {
    channel: "agent.event",
    sessionId: "session",
    requestId: "old",
    step: 1,
    timestamp: "2026-10-29T00:00:00Z",
  };
  projectRunHistoryDiagnostics(useStore.getState(), run, [
    {
      ...envelope,
      kind: EventKinds.ModelCompleted,
      sequence: 3,
      data: {
        messageIndex: 0,
        usage: { source: "provider_reported", inputTokens: 80, totalTokens: 87 },
        outcome: "failed",
        errorMessage: "Provider rejected",
      },
    },
    {
      ...envelope,
      kind: EventKinds.ModelStarted,
      sequence: 2,
      data: { messageIndex: 0, model: "model", contextSnapshot: snapshot },
    },
  ]);
  expect(run.steps[0]).toMatchObject({
    status: "failed",
    errorMessage: "Provider rejected",
    contextSnapshot: snapshot,
    modelUsage: { inputTokens: 80 },
  });
  expect(run.usage.totalTokens).toBe(999);
});

test("historical child requests retain their own snapshot and usage without changing the parent model", () => {
  seed();
  const run = structuredClone(useStore.getState().sessions.session.runs[0]);
  run.modelProvider = { providerId: "parent", model: "parent-model" };
  run.usage = { source: "provider_reported", totalTokens: 999 };
  const envelope = {
    channel: "agent.event",
    sessionId: "session",
    requestId: "child-request",
    scope: { parentRequestId: "old", childRunId: "child", agentName: "Research", role: "childAgent" },
    step: 1,
    timestamp: "2026-10-29T00:00:00Z",
  };
  projectRunHistoryDiagnostics(useStore.getState(), run, [
    {
      ...envelope,
      kind: EventKinds.ModelStarted,
      sequence: 2,
      data: { messageIndex: 0, model: "child-model", contextSnapshot: snapshot },
    },
    {
      ...envelope,
      kind: EventKinds.ModelCompleted,
      sequence: 3,
      data: {
        messageIndex: 0,
        provider: { providerId: "child", model: "child-model" },
        usage: { source: "provider_reported", inputTokens: 80, totalTokens: 87 },
        outcome: "failed",
        errorMessage: "Child request rejected",
      },
    },
  ]);
  expect(run.steps.find((step) => step.scope?.childRunId === "child")).toMatchObject({
    status: "failed",
    contextSnapshot: snapshot,
    modelUsage: { inputTokens: 80 },
    modelName: "child-model",
    errorMessage: "Child request rejected",
  });
  expect(run.modelProvider.model).toBe("parent-model");
  expect(run.usage.totalTokens).toBe(999);
});

test("an unavailable explicit request cannot silently display the latest request", () => {
  seed();
  renderWithFrontendProviders(
    React.createElement(ContextInspectionView, {
      run: useStore.getState().sessions.session.runs[0],
      requestId: "missing-request",
      state: createContextInspectionState(),
      onStateChange: () => {},
      onSelectRequest: () => {},
    }),
  );
  expect(document.querySelector(".insights-context-total strong")).toHaveTextContent("—");
  expect(screen.getByText(t("insights.context.historyUnavailable"))).toBeVisible();
});

test("overview mounts no context document browser and refresh resumes after the saved high-water mark", async () => {
  seed();
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(JSON.stringify({ sessionId: "session", through: 100, events: [] }), {
        headers: { "Content-Type": "application/json" },
      }),
  );
  renderPanel({ initialView: "overview" });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  expect(document.querySelector("[data-session-overview]")).toBeVisible();
  expect(document.querySelector("[data-context-inspection]")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: t("insights.refresh") }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(new URL(fetch.mock.calls[1][0]).searchParams.get("after")).toBe("100");
  expect(new URL(fetch.mock.calls[1][0]).searchParams.has("through")).toBe(false);
});

test("streamed answer deltas do not commit another render of the insights panel", async () => {
  seed();
  const onRender = vi.fn();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ sessionId: "session", through: 100, events: [] }), {
      headers: { "Content-Type": "application/json" },
    }),
  );
  renderWithFrontendProviders(
    React.createElement(
      WorkspaceResourceProvider,
      { httpBaseUrl: "http://backend.test" },
      React.createElement(React.Profiler, { id: "insights", onRender }, React.createElement(SessionInsightsPanel)),
    ),
  );
  await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  const commits = onRender.mock.calls.length;
  act(() => {
    for (let index = 0; index < 100; index++) ingest(EventKinds.ModelDelta, { messageIndex: 0, text: "answer delta " });
  });
  expect(useStore.getState().sessions.session.runs[0].streamingRaw).toContain("answer delta");
  expect(onRender).toHaveBeenCalledTimes(commits);
});

test("switching conversations reuses each checkpoint without retaining the previous conversation in the surface", async () => {
  seed();
  useStore.getState().ingest({
    channel: "agent.event",
    kind: EventKinds.RunStarted,
    layer: "progress",
    phase: "model",
    sequence: 10,
    timestamp: "2026-10-29T00:00:00Z",
    sessionId: "second",
    requestId: "second-run",
    step: 1,
    data: { input: "second task" },
  });
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const sessionId = new URL(input).searchParams.get("sessionId");
    return new Response(JSON.stringify({ sessionId, through: sessionId === "session" ? 100 : 200, events: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  });
  renderPanel({ initialView: "overview" });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  act(() => useStore.setState({ activeSessionId: "second" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  expect(document.querySelector(".insights-context-events-list")).not.toHaveTextContent("earlier-model");
  act(() => useStore.setState({ activeSessionId: "session" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(new URL(fetch.mock.calls[2][0]).searchParams.get("after")).toBe("100");
  await waitFor(() =>
    expect(document.querySelector(".insights-context-events-list")).toHaveTextContent("earlier-model"),
  );
});
