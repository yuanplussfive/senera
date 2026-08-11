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

test("live tool preface is a separate message above the execution feed", () => {
  renderWithFrontendProviders(
    React.createElement(StreamingRow, {
      run: createRun({
        visibleKind: "tool_preface",
        displayText: "搜索当前已加载的工具目录……",
        steps: [
          {
            id: "model-step",
            kind: "model",
            title: "调用模型",
            status: "running",
            startedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    }),
  );

  const preface = document.querySelector("[data-assistant-tool-preface-stream]");
  expect(preface).toBeInTheDocument();
  expect(preface).toContainElement(screen.getByText("搜索当前已加载的工具目录……"));
  expect(
    document.querySelector("[data-assistant-tool-preface-stream] [data-assistant-streaming-body]"),
  ).toBeInTheDocument();
  expect(
    document.querySelector("[data-assistant-tool-preface-stream] + .conversation-frame--wide"),
  ).toBeInTheDocument();
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
