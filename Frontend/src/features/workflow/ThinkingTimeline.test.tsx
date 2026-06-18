import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../../shared/ui";
import type { RunRecord, SessionRecord, StoreState, TimelineStep } from "../../store/sessionStore";
import { ThinkingTimeline } from "./ThinkingTimeline";

const now = "2026-06-12T00:00:00.000Z";
const mockStoreState = vi.hoisted(() => ({ current: {} as StoreState }));

vi.mock("../../store/sessionStore", () => ({
  useStore: <T,>(selector: (state: StoreState) => T): T => selector(mockStoreState.current),
}));

function createStep(index: number): TimelineStep {
  return {
    id: `step-${index}`,
    kind: "tool",
    title: `Step ${index}`,
    status: "done",
    startedAt: now,
    endedAt: now,
  };
}

function createRun(stepCount: number): RunRecord {
  return {
    requestId: "run-1",
    revision: 1,
    startedAt: now,
    endedAt: now,
    status: "completed",
    input: "inspect workflow",
    steps: Array.from({ length: stepCount }, (_, index) => createStep(index + 1)),
    streamingRaw: "",
    xmlPreview: "",
    visibleText: "",
    displayText: "",
    visibleKind: "unknown",
    expectedOutputMode: "unknown",
    decisionMode: "none",
    pendingToolArgsByName: {},
  };
}

function createSession(run: RunRecord): SessionRecord {
  return {
    sessionId: "session-1",
    title: "Session",
    status: "ready",
    createdAt: now,
    updatedAt: now,
    entryCount: 0,
    messageCount: 0,
    messages: [],
    runs: [run],
  };
}

describe("ThinkingTimeline", () => {
  beforeEach(() => {
    const session = createSession(createRun(11));

    mockStoreState.current = {
      sessions: { [session.sessionId]: session },
      sessionOrder: [session.sessionId],
      activeSessionId: session.sessionId,
      rightPanelCollapsed: true,
      viewedRunIdBySession: {},
      toggleRightPanel: vi.fn(),
      setViewedRun: vi.fn(),
    } as unknown as StoreState;
  });

  it("keeps run step counts out of the collapsed rail", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ThinkingTimeline presentation="auto" />
      </TooltipProvider>,
    );

    expect(markup).toContain("aria-label=\"expand\"");
    expect(markup).not.toContain("11 步");
  });
});
