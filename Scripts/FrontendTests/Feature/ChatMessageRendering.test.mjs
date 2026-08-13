import React from "react";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

vi.mock("../../../Frontend/src/shared/ui/Tooltip.tsx", () => ({
  TooltipProvider: ({ children }) => React.createElement(React.Fragment, null, children),
  Tooltip: ({ children }) => React.createElement(React.Fragment, null, children),
}));

const { AssistantMessageBody } = await import("../../../Frontend/src/features/chat/AssistantMessageBody.tsx");
const { StreamingRow } = await import("../../../Frontend/src/features/chat/StreamingRow.tsx");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

test("tool preface keeps its progress text without rendering a redundant badge", () => {
  renderWithFrontendProviders(
    React.createElement(AssistantMessageBody, {
      message: {
        kind: "AssistantToolPreface",
        content: "我先读取项目配置。",
      },
    }),
  );

  expect(screen.getByText("我先读取项目配置。")).toBeInTheDocument();
  expect(screen.queryByText("工具调用前回复")).not.toBeInTheDocument();
});

test("streaming assistant content uses the same readable body and caret for prefaces and answers", () => {
  renderWithFrontendProviders(
    React.createElement(AssistantMessageBody, {
      message: {
        kind: "AssistantFinal",
        content: "正在生成的回答",
      },
      streaming: true,
    }),
  );

  expect(document.querySelector("[data-assistant-streaming-body]")).toBeInTheDocument();
  expect(screen.getByText("正在生成的回答")).toBeInTheDocument();
  expect(document.querySelector("[data-assistant-streaming-body] .caret-blink")).toBeInTheDocument();
});

test("live tool preface follows its execution status inside one assistant turn", async () => {
  renderWithFrontendProviders(
    React.createElement(StreamingRow, {
      run: createRun({
        visibleKind: "tool_preface",
        displayText: "搜索当前已加载的工具目录……",
        steps: [
          {
            id: "tool-step",
            kind: "tool",
            title: "搜索工作区",
            status: "running",
            startedAt: "2026-01-01T00:00:00.000Z",
            toolName: "WorkspaceGrep",
            callId: "call-workspace-grep",
          },
        ],
      }),
    }),
  );

  const turn = document.querySelector("[data-assistant-turn='request-1']");
  expect(turn).toBeInTheDocument();
  expect(turn).toContainElement(screen.getByText("搜索当前已加载的工具目录……"));
  expect(turn.querySelector("[data-assistant-streaming-body]")).toHaveTextContent("搜索当前已加载的工具目录……");
  expect(turn.querySelector("[data-assistant-turn-execution]")).toBeInTheDocument();
  const stage = turn.querySelector("[data-assistant-turn-stage='execution']");
  const execution = stage.firstElementChild;
  const body = turn.querySelector("[data-assistant-streaming-body]");
  expect(execution).toHaveAttribute("aria-hidden", "true");
  expect(execution.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  expect(turn.querySelectorAll("[data-message-avatar='assistant']")).toHaveLength(1);
  expect(document.querySelectorAll(".conversation-frame--wide")).toHaveLength(1);
  expect(screen.getAllByText("搜索当前已加载的工具目录……")).toHaveLength(1);
});

function createRun(overrides = {}) {
  return {
    requestId: "request-1",
    status: "running",
    input: "run input",
    startedAt: "2026-01-01T00:00:00.000Z",
    steps: [],
    displayText: "",
    displayTarget: "",
    displayedChars: 0,
    expectedOutputMode: "open",
    ...overrides,
  };
}
