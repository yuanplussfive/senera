import React from "react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

vi.mock("../../../Frontend/src/shared/ui/Tooltip.tsx", () => ({
  TooltipProvider: ({ children }) => React.createElement(React.Fragment, null, children),
  Tooltip: ({ children }) => React.createElement(React.Fragment, null, children),
}));

const { MessageList, scrollConversationAnchorIntoView } =
  await import("../../../Frontend/src/features/chat/MessageList.tsx");
const { ChatActivityDock } = await import("../../../Frontend/src/features/chat/ChatActivityDock.tsx");
const { projectAssistantTurns } = await import("../../../Frontend/src/features/chat/assistantTurnProjection.ts");
const { projectAssistantTurnStages } =
  await import("../../../Frontend/src/features/chat/assistantTurnStageProjection.ts");
const {
  ConversationEventRail,
  projectConversationEventMarkers,
  projectConversationEvents,
  projectConversationEventWindow,
  readConversationEventIndex,
  readConversationEventPositionIndex,
} = await import("../../../Frontend/src/features/chat/ConversationEventRail.tsx");
const { frontendMessage } = await import("../../../Frontend/src/i18n/frontendMessageCatalog.ts");
const { createApproval, createMessage, createMessageListProps, createRun, createUserProfile, stageTool } =
  await import("./chatCoreComponentFixtures.mjs");
const { resetVirtuosoTestCalls, virtuosoTestCalls } = await import("../mocks/react-virtuoso.mjs");

afterEach(() => {
  cleanup();
  resetVirtuosoTestCalls();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

test("assistant turn projection preserves a cancelled execution slice between its request and follow-up", () => {
  const requestId = "request-cancelled-slice";
  const startedAt = "2026-01-01T00:00:00.000Z";
  const userMessage = createMessage({
    id: "cancelled-user",
    requestId,
    role: "user",
    content: "检查项目并告诉我结果",
    createdAt: startedAt,
  });
  const followUpMessage = createMessage({
    id: "cancelled-follow-up",
    requestId: "request-follow-up",
    role: "user",
    content: "继续",
    createdAt: "2026-01-01T00:01:00.000Z",
  });
  const cancelledRun = createRun({
    requestId,
    status: "cancelled",
    startedAt,
    endedAt: "2026-01-01T00:00:30.000Z",
    steps: [
      stageTool("cancelled-tool", "WorkspaceRead", startedAt),
      {
        id: `${requestId}-cancelled`,
        kind: "error",
        title: "已取消",
        status: "failed",
        startedAt: "2026-01-01T00:00:30.000Z",
        endedAt: "2026-01-01T00:00:30.000Z",
      },
    ],
  });

  const projected = projectAssistantTurns([userMessage, followUpMessage], [cancelledRun]);

  expect(projected).toHaveLength(3);
  expect(projected[0]).toBe(userMessage);
  expect(projected[1]).toMatchObject({
    key: `assistant-run-slice:${requestId}`,
    requestId,
    streaming: false,
    run: cancelledRun,
  });
  expect(projected[2]).toBe(followUpMessage);

  const stages = projectAssistantTurnStages(projected[1]);
  expect(stages).toHaveLength(1);
  expect(stages[0]).toMatchObject({ kind: "execution", current: false });
  expect(stages[0].run?.steps.map((step) => step.id)).toEqual(["cancelled-tool", `${requestId}-cancelled`]);
});

test("a live execution stage keeps its decision identity when the preface is persisted", () => {
  const requestId = "request-stable-decision-stage";
  const createdAt = "2026-01-01T00:00:00.000Z";
  const preface = createMessage({
    id: "decision-preface",
    requestId,
    role: "assistant",
    kind: "AssistantToolPreface",
    content: "先读取配置。",
    createdAt,
  });
  const run = createRun({
    requestId,
    status: "running",
    visibleKind: "tool_preface",
    steps: [
      {
        id: `${requestId}-assistant-message-${preface.id}`,
        kind: "decision",
        title: "规划读取配置",
        status: "done",
        startedAt: createdAt,
        endedAt: createdAt,
        decisionKind: "tool_preface",
      },
      stageTool("stable-decision-tool", "WorkspaceRead", createdAt, "running"),
    ],
  });
  const liveTurn = {
    __assistantTurn: true,
    key: `assistant-turn:${requestId}:0`,
    requestId,
    createdAt,
    messages: [],
    run,
    streaming: true,
  };
  const persistedTurn = { ...liveTurn, messages: [preface] };

  const liveStage = projectAssistantTurnStages(liveTurn).find((stage) => stage.kind === "execution");
  const persistedStage = projectAssistantTurnStages(persistedTurn).find((stage) => stage.kind === "execution");

  expect(liveStage?.id).toBe(`stage:${requestId}:step:${requestId}-assistant-message-${preface.id}`);
  expect(persistedStage?.id).toBe(liveStage?.id);
});

test("assistant turn exposes one action menu bound to the final reply", async () => {
  const user = userEvent.setup();
  const onRegenerate = vi.fn();
  const preface = createMessage({
    id: "action-preface",
    requestId: "request-actions",
    kind: "AssistantToolPreface",
    content: "先执行工具。",
  });
  const answer = createMessage({
    id: "action-answer",
    requestId: "request-actions",
    kind: "AssistantFinal",
    content: "最终结论。",
  });

  renderWithFrontendProviders(
    React.createElement(MessageList, createMessageListProps({ messages: [preface, answer], onRegenerate })),
  );

  const actionMenu = await waitFor(
    () => {
      const menus = screen.getAllByRole("button", { name: "更多操作" });
      expect(menus).toHaveLength(1);
      return menus[0];
    },
    { timeout: 5_000 },
  );
  await user.click(actionMenu);
  await user.click(screen.getByRole("menuitem", { name: "从此处重新回答" }));
  expect(onRegenerate).toHaveBeenCalledWith(answer);
});

test("conversation event rail keeps user and terminal assistant landmarks only", () => {
  const events = projectConversationEvents([
    { key: "user-1", requestId: "request-1", eventKind: "user_request", content: "检查构建" },
    {
      key: "preface-1",
      requestId: "request-1",
      eventKind: null,
      content: "我先读取项目配置。",
    },
    {
      key: "preface-2",
      requestId: "request-1",
      eventKind: null,
      content: "我再检查测试配置。",
    },
    { key: "tool-1", requestId: "request-1", eventKind: null, content: "WorkspaceRead completed" },
    { key: "answer-1", requestId: "request-1", eventKind: "assistant_final", content: "构建通过。" },
  ]);

  expect(events).toMatchObject([
    { itemIndex: 0, kind: "user_request", content: "检查构建" },
    { itemIndex: 4, kind: "assistant_final", content: "构建通过。" },
  ]);
  expect(readConversationEventIndex(events, 2)).toBe(0);
  expect(readConversationEventIndex(events, 3)).toBe(0);
  expect(readConversationEventIndex(events, 4)).toBe(1);
  expect(readConversationEventIndex(events, 99)).toBe(1);
});

test("conversation event rail positions landmarks from measured message heights", () => {
  const events = projectConversationEvents([
    { key: "user-1", requestId: "request-1", eventKind: "user_request", content: "First" },
    { key: "tool-1", requestId: "request-1", eventKind: null, content: "Internal tool" },
    { key: "answer-1", requestId: "request-1", eventKind: "assistant_final", content: "First answer" },
  ]);
  const markers = projectConversationEventMarkers(
    events,
    ["user-1", "tool-1", "answer-1"],
    new Map([
      ["user-1", 100],
      ["tool-1", 300],
      ["answer-1", 100],
    ]),
    132,
  );

  expect(markers.map((marker) => marker.position)).toEqual([0, 0.8]);
});

test("conversation event rail distinguishes landmarks inside one grouped assistant turn", () => {
  const events = projectConversationEvents([
    {
      key: "ask-grouped",
      requestId: "request-grouped",
      eventKind: "assistant_ask",
      content: "需要确认。",
      itemIndex: 1,
      itemProgress: 0.2,
    },
    {
      key: "answer-grouped",
      requestId: "request-grouped",
      eventKind: "assistant_final",
      content: "检查完成。",
      itemIndex: 1,
      itemProgress: 0.8,
    },
  ]);
  const markers = projectConversationEventMarkers(
    events,
    ["user", "assistant-turn"],
    new Map([
      ["user", 100],
      ["assistant-turn", 500],
    ]),
    132,
  );

  expect(markers.map((marker) => marker.position)).toEqual([1 / 3, 5 / 6]);
  expect(readConversationEventIndex(events, 1)).toBe(0);
  expect(readConversationEventPositionIndex(markers, 0.4)).toBe(0);
  expect(readConversationEventPositionIndex(markers, 0.9)).toBe(1);
});

test("conversation event rail keeps long conversations in a centered local window", () => {
  const events = Array.from({ length: 40 }, (_, index) => `event-${index}`);
  expect(projectConversationEventWindow(events, 20, 7)).toEqual([
    { event: "event-17", index: 17 },
    { event: "event-18", index: 18 },
    { event: "event-19", index: 19 },
    { event: "event-20", index: 20 },
    { event: "event-21", index: 21 },
    { event: "event-22", index: 22 },
    { event: "event-23", index: 23 },
  ]);
  expect(projectConversationEventWindow(events, 0, 7)[0]).toEqual({ event: "event-0", index: 0 });
  expect(projectConversationEventWindow(events, 39, 7).at(-1)).toEqual({ event: "event-39", index: 39 });
});

test("conversation event rail uses mounted anchors to distinguish events in one row", () => {
  const scroller = document.createElement("div");
  const firstAnchor = document.createElement("div");
  const secondAnchor = document.createElement("div");
  firstAnchor.id = "scrollspy-anchor-first";
  secondAnchor.id = "scrollspy-anchor-second";
  scroller.append(firstAnchor, secondAnchor);
  document.body.append(scroller);
  Object.defineProperties(scroller, {
    clientHeight: { configurable: true, value: 400 },
    scrollHeight: { configurable: true, value: 1_000 },
    scrollTop: { configurable: true, writable: true, value: 200 },
  });
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({
    bottom: 500,
    height: 400,
    left: 0,
    right: 800,
    top: 100,
    width: 800,
    x: 0,
    y: 100,
    toJSON: () => ({}),
  });
  vi.spyOn(firstAnchor, "getBoundingClientRect").mockReturnValue({
    bottom: 240,
    height: 60,
    left: 0,
    right: 700,
    top: 180,
    width: 700,
    x: 0,
    y: 180,
    toJSON: () => ({}),
  });
  vi.spyOn(secondAnchor, "getBoundingClientRect").mockReturnValue({
    bottom: 420,
    height: 60,
    left: 0,
    right: 700,
    top: 360,
    width: 700,
    x: 0,
    y: 360,
    toJSON: () => ({}),
  });
  const onActiveEventChange = vi.fn();
  const events = [
    {
      id: "event:first",
      itemIndex: 0,
      itemProgress: 0.82,
      anchorId: firstAnchor.id,
      kind: "assistant_ask",
      content: "需要确认。",
    },
    {
      id: "event:second",
      itemIndex: 0,
      itemProgress: 0.82,
      anchorId: secondAnchor.id,
      kind: "assistant_final",
      content: "已完成。",
    },
  ];

  renderWithFrontendProviders(
    React.createElement(ConversationEventRail, {
      events,
      itemKeys: ["assistant-turn"],
      measuredHeights: new Map([["assistant-turn", 500]]),
      defaultItemHeight: 132,
      activeEventIndex: 1,
      scroller,
      onActiveEventChange,
      onNavigate: vi.fn(),
    }),
  );

  expect(onActiveEventChange).toHaveBeenCalledWith(0);
  scroller.remove();
});

test("conversation event rail previews and navigates to an exact reply event", async () => {
  const user = userEvent.setup();
  const onNavigate = vi.fn();
  const onActiveEventChange = vi.fn();
  const events = projectConversationEvents([
    { key: "user-1", requestId: "request-1", eventKind: "user_request", content: "检查构建" },
    {
      key: "preface-1",
      requestId: "request-1",
      eventKind: null,
      content: "我先读取配置。",
    },
    { key: "answer-1", requestId: "request-1", eventKind: "assistant_final", content: "构建通过。" },
  ]);

  renderWithFrontendProviders(
    React.createElement(ConversationEventRail, {
      events,
      itemKeys: ["user-1", "preface-1", "answer-1"],
      measuredHeights: new Map(),
      defaultItemHeight: 132,
      activeEventIndex: 0,
      scroller: null,
      onActiveEventChange,
      onNavigate,
    }),
  );

  expect(screen.getByTestId("chat-event-rail")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "跳到第 1 个事件：用户请求" })).toHaveAttribute(
    "data-kind",
    "user_request",
  );
  const finalReply = screen.getByRole("button", { name: "跳到第 2 个事件：最终回复" });
  expect(finalReply).toHaveAttribute("data-kind", "assistant_final");
  expect(finalReply.querySelector(".chat-event-rail__tick")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "跳到上一个回复事件" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "跳到下一个回复事件" })).toBeEnabled();
  await user.hover(finalReply);
  expect(screen.getByRole("tooltip")).toHaveTextContent("Senera");
  expect(screen.getByRole("tooltip")).toHaveTextContent("构建通过。");
  expect(screen.getByRole("tooltip")).not.toHaveTextContent("第 3/3 个回复事件");

  await user.click(finalReply);
  expect(onActiveEventChange).not.toHaveBeenCalled();
  expect(onNavigate).toHaveBeenCalledWith(events[1]);
});

test("conversation event rail keeps an explicit selection when two events fit in the viewport", async () => {
  const user = userEvent.setup();
  const onNavigate = vi.fn();
  const onActiveEventChange = vi.fn();
  const scroller = document.createElement("div");
  Object.defineProperties(scroller, {
    clientHeight: { configurable: true, value: 800 },
    scrollHeight: { configurable: true, value: 520 },
    scrollTop: { configurable: true, writable: true, value: 0 },
  });
  const events = projectConversationEvents([
    { key: "user-short", requestId: "request-short", eventKind: "user_request", content: "检查两条消息" },
    { key: "answer-short", requestId: "request-short", eventKind: "assistant_final", content: "两条消息都在视野内。" },
  ]);

  renderWithFrontendProviders(
    React.createElement(ConversationEventRail, {
      events,
      itemKeys: ["user-short", "answer-short"],
      measuredHeights: new Map(),
      defaultItemHeight: 132,
      activeEventIndex: 0,
      scroller,
      onActiveEventChange,
      onNavigate,
    }),
  );

  expect(onActiveEventChange).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "跳到第 2 个事件：最终回复" }));

  expect(onActiveEventChange).not.toHaveBeenCalled();
  expect(onNavigate).toHaveBeenCalledWith(events[1]);
});

test("conversation navigation aligns the reply inside the chat scroller only", () => {
  const scroller = document.createElement("div");
  const anchor = document.createElement("div");
  scroller.append(anchor);
  Object.defineProperties(scroller, {
    clientHeight: { configurable: true, value: 400 },
    scrollHeight: { configurable: true, value: 1_000 },
    scrollTop: { configurable: true, writable: true, value: 100 },
  });
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({
    bottom: 500,
    height: 400,
    left: 0,
    right: 800,
    top: 100,
    width: 800,
    x: 0,
    y: 100,
    toJSON: () => ({}),
  });
  vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
    bottom: 490,
    height: 40,
    left: 0,
    right: 700,
    top: 450,
    width: 700,
    x: 0,
    y: 450,
    toJSON: () => ({}),
  });
  const scrollTo = vi.fn(({ top }) => {
    scroller.scrollTop = Number(top);
  });
  Object.defineProperty(scroller, "scrollTo", { configurable: true, value: scrollTo });
  const scrollIntoView = vi.fn();
  Object.defineProperty(anchor, "scrollIntoView", { configurable: true, value: scrollIntoView });

  scrollConversationAnchorIntoView(scroller, anchor);

  expect(scrollTo).toHaveBeenCalledWith({ top: 270, behavior: "auto" });
  expect(scrollIntoView).not.toHaveBeenCalled();
});

test("message list advances from the third event to the fourth through Virtuoso", async () => {
  const user = userEvent.setup();
  const messages = [
    createMessage({ id: "nav-user-1", requestId: "nav-request-1", role: "user", content: "第一问" }),
    createMessage({
      id: "nav-answer-1",
      requestId: "nav-request-1",
      kind: "AssistantFinal",
      content: "第一答",
    }),
    createMessage({ id: "nav-user-2", requestId: "nav-request-2", role: "user", content: "第二问" }),
    createMessage({
      id: "nav-answer-2",
      requestId: "nav-request-2",
      kind: "AssistantFinal",
      content: "第二答",
    }),
  ];

  renderWithFrontendProviders(React.createElement(MessageList, createMessageListProps({ messages })));

  const thirdEvent = await screen.findByRole("button", { name: "跳到第 3 个事件：用户请求" });
  const fourthEvent = await screen.findByRole("button", { name: "跳到第 4 个事件：最终回复" });
  await user.click(thirdEvent);
  await waitFor(() => expect(thirdEvent).toHaveAttribute("data-active", "true"));

  resetVirtuosoTestCalls();
  await user.click(screen.getByRole("button", { name: "跳到下一个回复事件" }));

  await waitFor(() => expect(fourthEvent).toHaveAttribute("data-active", "true"));
  expect(virtuosoTestCalls).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        method: "scrollIntoView",
        index: 3,
        align: "center",
        behavior: "smooth",
        calculateViewLocation: expect.any(Function),
      }),
    ]),
  );
});

test("message list keeps the fourth event when adjacent events share one assistant row", async () => {
  const user = userEvent.setup();
  const requestId = "nav-grouped-request";
  const messages = [
    createMessage({ id: "grouped-user", requestId: "grouped-user-request", role: "user", content: "开始检查" }),
    createMessage({
      id: "grouped-ask",
      requestId,
      kind: "AssistantAsk",
      content: "需要确认范围。",
    }),
    createMessage({
      id: "grouped-answer",
      requestId,
      kind: "AssistantFinal",
      content: "检查完成。",
    }),
    createMessage({
      id: "grouped-error",
      requestId,
      kind: "Error",
      content: "发现一个需要留意的错误。",
    }),
  ];

  renderWithFrontendProviders(React.createElement(MessageList, createMessageListProps({ messages })));

  const thirdEvent = await screen.findByRole("button", { name: "跳到第 3 个事件：最终回复" });
  await user.click(thirdEvent);
  await waitFor(() => expect(thirdEvent).toHaveAttribute("data-active", "true"));

  await user.click(screen.getByRole("button", { name: "跳到下一个回复事件" }));

  const fourthEvent = await screen.findByRole("button", { name: "跳到第 4 个事件：错误回复" });
  await waitFor(() => expect(fourthEvent).toHaveAttribute("data-active", "true"));
  expect(thirdEvent).toHaveAttribute("data-active", "false");
  expect(virtuosoTestCalls).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        method: "scrollIntoView",
        index: 1,
        align: "center",
        behavior: "smooth",
        calculateViewLocation: expect.any(Function),
      }),
    ]),
  );
});

test("message list reveals an available final answer while the run is still settling", async () => {
  const answer = createMessage({
    id: "message-available-answer",
    requestId: "request-available-answer",
    content: "Answer is already available.",
  });
  const settlingRun = createRun({
    requestId: "request-available-answer",
    outputState: "available",
    visibleKind: "final_answer",
    displayMessageId: answer.id,
    liveActivity: "compacting_context",
  });

  renderWithFrontendProviders(
    React.createElement(
      MessageList,
      createMessageListProps({ messages: [answer], runs: [settlingRun], currentRun: settlingRun }),
    ),
  );

  await waitFor(() => expect(screen.getByText("Answer is already available.")).toBeVisible());
  expect(
    screen.getByText(
      frontendMessage("workflow.activity.running", {
        activity: frontendMessage("workflow.activity.compactingContext"),
      }),
    ),
  ).toBeVisible();
});

test("message list accepts repeated scroller refs without a render loop", () => {
  renderWithFrontendProviders(
    React.createElement(
      MessageList,
      createMessageListProps({
        messages: [createMessage({ id: "message-repeat", role: "user", content: "keep scrolling" })],
      }),
    ),
  );

  expect(screen.getByText("keep scrolling")).toBeInTheDocument();
});

test("message list refreshes the user profile while keeping the project identity", () => {
  const userMessage = createMessage({ id: "message-user-profile", role: "user", content: "hello" });
  const assistantMessage = createMessage({ id: "message-provider", role: "assistant", content: "answer" });
  const { rerender } = renderWithFrontendProviders(
    React.createElement(
      MessageList,
      createMessageListProps({
        messages: [userMessage, assistantMessage],
        userProfile: createUserProfile("Ada"),
      }),
    ),
  );

  expect(screen.getByAltText("Ada")).toBeInTheDocument();
  expect(screen.getByText("Senera")).toHaveClass("text-[13.5px]", "font-semibold");
  expect(document.querySelector("[data-message-avatar='assistant']")).toHaveClass("h-8", "w-8");
  expect(document.querySelector('[data-message-avatar="assistant"] img[src="./favicon.svg"]')).not.toBeNull();
  expect(document.querySelector("[data-message-avatar='assistant']")).not.toHaveClass(
    "rounded-full",
    "border",
    "bg-paper-100",
  );
  expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  expect(screen.getByAltText("Ada").closest("[data-message-avatar='user']")).toHaveClass("h-8", "w-8");
  expect(screen.getByText("hello").closest(".conversation-frame--user")).toHaveClass("items-start", "justify-end");
  expect(screen.getByText("hello")).toHaveClass("cursor-pointer");

  rerender(
    React.createElement(
      MessageList,
      createMessageListProps({
        messages: [userMessage, assistantMessage],
        userProfile: createUserProfile("Grace"),
      }),
    ),
  );

  expect(screen.getByAltText("Grace")).toBeInTheDocument();
  expect(screen.queryByText("Beta")).not.toBeInTheDocument();
  expect(document.querySelector('[data-message-avatar="assistant"] img[src="./favicon.svg"]')).not.toBeNull();
});

test("user messages edit inline and keep the existing replay command", async () => {
  const user = userEvent.setup();
  const onEditUserMessage = vi.fn();
  const userMessage = createMessage({
    id: "message-inline-edit",
    requestId: "request-inline-edit",
    role: "user",
    content: "原始问题",
  });
  renderWithFrontendProviders(
    React.createElement(
      MessageList,
      createMessageListProps({
        messages: [userMessage],
        onEditUserMessage,
      }),
    ),
  );

  await user.click(screen.getByRole("button", { name: "编辑这条消息" }));

  const editor = screen.getByRole("textbox", { name: "编辑用户消息" });
  expect(editor).toHaveValue("原始问题");
  expect(screen.queryByRole("dialog", { name: "编辑用户消息" })).not.toBeInTheDocument();
  await user.clear(editor);
  await user.type(editor, "更新后的问题");
  await user.click(screen.getByRole("button", { name: "保存并重新回答" }));

  expect(onEditUserMessage).toHaveBeenCalledWith(userMessage, "更新后的问题");
  expect(screen.queryByRole("textbox", { name: "编辑用户消息" })).not.toBeInTheDocument();
});

test("completed assistant turns keep workflow details out of the final stage", async () => {
  const user = userEvent.setup();
  const onViewWorkflow = vi.fn();
  const assistantMessage = createMessage({
    id: "message-completed-workflow",
    requestId: "request-completed-workflow",
    content: "Completed answer body",
  });
  const completedRun = createRun({
    requestId: "request-completed-workflow",
    status: "completed",
    endedAt: "2026-01-01T00:00:03.000Z",
    visibleKind: "final_answer",
    steps: [
      {
        id: "answer-step",
        kind: "answer",
        title: "生成回复",
        status: "done",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T00:00:03.000Z",
      },
    ],
  });

  renderWithFrontendProviders(
    React.createElement(
      MessageList,
      createMessageListProps({
        messages: [assistantMessage],
        runs: [completedRun],
        onViewWorkflow,
      }),
    ),
  );

  const answer = screen.getByText("Completed answer body");
  const finalStage = answer.closest("[data-assistant-turn-stage='final']");
  expect(finalStage).toContainElement(answer);
  expect(screen.queryByRole("button", { name: /已完成.*1 步.*3\.0s/ })).not.toBeInTheDocument();
  expect(screen.queryByText("生成回复")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "查看工作流" }));
  expect(onViewWorkflow).toHaveBeenCalledTimes(1);
});

test("approvals in the activity dock refresh when their content changes at the same length", async () => {
  const initialRun = createRun({
    approvals: [createApproval({ subject: { kind: "tool_call", toolName: "Read config", arguments: {} } })],
    revision: 1,
  });
  const { rerender } = renderWithFrontendProviders(
    React.createElement(ChatActivityDock, {
      sessionId: "session-1",
      runs: [initialRun],
      approvalDisabled: false,
    }),
  );

  expect(await screen.findByText("Read config")).toBeInTheDocument();

  const updatedRun = {
    ...initialRun,
    approvals: [createApproval({ subject: { kind: "tool_call", toolName: "Write config", arguments: {} } })],
  };
  rerender(
    React.createElement(ChatActivityDock, {
      sessionId: "session-1",
      runs: [updatedRun],
      approvalDisabled: false,
    }),
  );

  expect(await screen.findByText("Write config")).toBeInTheDocument();
  expect(screen.queryByText("Read config")).not.toBeInTheDocument();
});
