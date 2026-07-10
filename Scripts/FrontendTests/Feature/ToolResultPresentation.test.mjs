import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { NodeDetailDrawer } from "../../../Frontend/src/features/workflow/NodeDetailDrawer.tsx";
import { deriveFeedModel } from "../../../Frontend/src/features/workflow/feedModel.ts";
import { TooltipProvider } from "../../../Frontend/src/shared/ui/Tooltip.tsx";

afterEach(cleanup);

test("tool result surface presents evidence and retains inspectable structured data", async () => {
  render(React.createElement(TooltipProvider, { delayDuration: 0 },
    React.createElement(NodeDetailDrawer, {
      step: toolStep(),
      onClose: () => undefined,
    }),
  ));

  expect(await screen.findByText("结果摘要")).toBeTruthy();
  expect(screen.getByText("关键事实")).toBeTruthy();
  expect(screen.getByText("证据")).toBeTruthy();
  expect(screen.getByText("变更")).toBeTruthy();
  expect(screen.getByText("原始工具结果")).toBeTruthy();
  expect(screen.getByText("北京：晴，26 C")).toBeTruthy();
  expect(screen.getAllByText("weather").length).toBeGreaterThan(0);
  expect(screen.getAllByText("temperature").length).toBeGreaterThan(0);
  expect(screen.getByText("Source/weather.ts")).toBeTruthy();
});

test("workflow feed uses the human summary rather than raw JSON", () => {
  const feed = deriveFeedModel({
    requestId: "request-weather",
    revision: 1,
    startedAt: "2026-07-10T00:00:00.000Z",
    status: "completed",
    input: "查询北京天气",
    steps: [toolStep()],
    streamingRaw: "",
    xmlPreview: "",
    visibleText: "",
    displayText: "",
    visibleKind: "unknown",
    expectedOutputMode: "unknown",
    decisionMode: "none",
    pendingToolArgsByName: {},
  });

  expect(feed.groups[0]?.items[0]?.subtitle).toBe("当前天气已更新。");
  expect(feed.groups[0]?.items[0]?.subtitle).not.toContain("senera.tool_observation");
});

function toolStep() {
  return {
    id: "tool-weather",
    kind: "tool",
    title: "调用 WeatherTool",
    status: "done",
    startedAt: "2026-07-10T00:00:00.000Z",
    endedAt: "2026-07-10T00:00:01.000Z",
    toolName: "WeatherTool",
    callId: "call_weather",
    toolPresentation: {
      type: "senera.tool_result_presentation.v1",
      version: 1,
      status: "success",
      headline: "北京：晴，26 C",
      summary: "当前天气已更新。",
      facts: [{
        name: "temperature",
        value: "26 C",
        kind: "weather",
      }],
      evidence: [{
        evidenceUri: "senera://evidence/weather-beijing",
        kind: "weather",
        display: "北京：晴，26 C",
        label: "北京天气",
        source: "Weather API",
        locator: "weather://beijing",
        confidence: 0.96,
      }],
      changes: [{
        kind: "workspace",
        status: "changed",
        key: "Source/weather.ts",
        summary: "modified: Source/weather.ts",
      }],
      artifactUri: "senera://artifact/weather",
    },
    toolResult: {
      type: "senera.tool_observation.v1",
      result: {
        city: "北京",
        temperature: 26,
        condition: "晴",
      },
    },
  };
}
