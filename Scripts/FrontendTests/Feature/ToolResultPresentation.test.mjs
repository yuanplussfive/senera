import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { NodeDetailDrawer } from "../../../Frontend/src/features/workflow/NodeDetailDrawer.tsx";
import { deriveFeedModel } from "../../../Frontend/src/features/workflow/feedModel.ts";
import { TooltipProvider } from "../../../Frontend/src/shared/ui/Tooltip.tsx";

afterEach(cleanup);

test("tool result surface presents evidence and retains inspectable structured data", async () => {
  render(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(NodeDetailDrawer, {
        step: toolStep(),
        onClose: () => undefined,
      }),
    ),
  );

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

test("workflow feed does not duplicate tool prefaces or expose their internal decision kind", () => {
  const prefaceStep = {
    id: "assistant-preface",
    kind: "decision",
    title: "工具调用前回复",
    description: "我先检查工作区文件。",
    status: "done",
    startedAt: "2026-07-10T00:00:01.000Z",
    endedAt: "2026-07-10T00:00:01.000Z",
    decisionKind: "tool_preface",
  };
  const baseRun = {
    requestId: "request-project",
    revision: 1,
    startedAt: "2026-07-10T00:00:00.000Z",
    status: "running",
    input: "分析项目",
    steps: [prefaceStep],
    streamingRaw: "",
    xmlPreview: "",
    visibleText: "我先检查工作区文件。",
    displayText: "我先检查工作区文件。",
    expectedOutputMode: "open",
    decisionMode: "tool_candidate",
    pendingToolArgsByName: {},
  };

  const toolFeed = deriveFeedModel({ ...baseRun, visibleKind: "tool_calls" });
  expect(toolFeed.bodyText).toBe("");
  expect(toolFeed.headline.title).not.toContain("tool_preface");
  expect(toolFeed.headline.subtitle).toBeUndefined();

  const answerFeed = deriveFeedModel({
    ...baseRun,
    visibleKind: "final_answer",
    visibleText: "这是最终回答。",
    displayText: "这是最终回答。",
    decisionMode: "final_text",
  });
  expect(answerFeed.bodyText).toBe("这是最终回答。");
  expect(answerFeed.headline.subtitle).toBeUndefined();
});

test("child-run detail shows directional messages as readable text", async () => {
  render(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(NodeDetailDrawer, {
        step: {
          id: "child-run-detail",
          kind: "delegation",
          title: "子代理",
          status: "running",
          startedAt: "2026-07-10T00:00:00.000Z",
          childRun: {
            id: "child-detail",
            status: "running",
            checkpointAvailable: true,
            lastActivityAt: "2026-07-10T00:00:02.000Z",
            modelOutputCharacters: 1280,
            assistantTurns: 3,
            toolCalls: { planned: 4, started: 4, completed: 2, failed: 1 },
            activeTools: ["WorkspaceRead", "WorkspaceGrep"],
            artifactCount: 2,
            grantedExtensionMs: 120_000,
            messages: [
              {
                id: "parent-detail-message",
                direction: "parent_to_child",
                kind: "follow_up",
                content: "请检查配置入口。",
                createdAt: "2026-07-10T00:00:01.000Z",
              },
              {
                id: "child-detail-message",
                direction: "child_to_parent",
                kind: "response",
                content: "配置入口位于 Source/AgentSystem。",
                createdAt: "2026-07-10T00:00:02.000Z",
              },
            ],
          },
        },
        onClose: () => undefined,
      }),
    ),
  );

  expect(await screen.findByText("当前活动")).toBeTruthy();
  expect(screen.getByText(/WorkspaceRead/)).toBeTruthy();
  expect(screen.getByText(/WorkspaceGrep/)).toBeTruthy();
  expect(screen.getByText("正在并行使用 2 个工具")).toBeTruthy();
  expect(await screen.findByText("子代理消息")).toBeTruthy();
  expect(screen.getByText("发给子代理")).toBeTruthy();
  expect(screen.getByText("子代理反馈")).toBeTruthy();
  expect(screen.getByText("请检查配置入口。")).toBeTruthy();
  expect(screen.getAllByText("配置入口位于 Source/AgentSystem。")).not.toHaveLength(0);
});

test("workflow feed presents transient run activity without requiring a workflow step", () => {
  const feed = deriveFeedModel({
    requestId: "request-live-activity",
    revision: 1,
    startedAt: "2026-07-10T00:00:00.000Z",
    status: "running",
    liveActivity: "running_agent_turn",
    activities: [
      {
        id: "activity-context",
        activity: "preparing_context",
        status: "done",
        step: 1,
        startedAt: "2026-07-10T00:00:00.000Z",
        endedAt: "2026-07-10T00:00:00.100Z",
      },
      {
        id: "activity-model",
        activity: "running_agent_turn",
        status: "running",
        step: 1,
        startedAt: "2026-07-10T00:00:00.100Z",
      },
    ],
    input: "分析项目",
    steps: [],
    streamingRaw: "",
    xmlPreview: "",
    visibleText: "",
    displayText: "",
    visibleKind: "unknown",
    expectedOutputMode: "open",
    decisionMode: "none",
    pendingToolArgsByName: {},
  });

  expect(feed).toMatchObject({
    headline: { id: "live-activity", title: "Senera 正在执行当前轮次", status: "running" },
    groups: [
      {
        label: "Senera 运行状态",
        variant: "activity",
        items: [
          { id: "activity-context", title: "准备对话上下文", status: "done" },
          { id: "activity-model", title: "执行当前轮次", status: "running" },
        ],
      },
    ],
    placeholder: "等待输出",
  });
});

test("context compaction overrides a stale running tool without hiding an available answer", () => {
  const staleTool = {
    ...toolStep(),
    id: "tool-stale",
    status: "running",
    toolName: "ShellCommandTool",
    title: "调用 ShellCommandTool",
    callId: "call-stale",
  };
  const feed = deriveFeedModel({
    requestId: "request-compacting",
    revision: 1,
    startedAt: "2026-07-10T00:00:00.000Z",
    status: "running",
    outputState: "available",
    liveActivity: "compacting_context",
    input: "分析项目",
    steps: [staleTool],
    streamingRaw: "",
    xmlPreview: "",
    visibleText: "最终回答已经生成。",
    displayText: "最终回答已经生成。",
    visibleKind: "final_answer",
    expectedOutputMode: "open",
    decisionMode: "final_text",
    pendingToolArgsByName: {},
  });

  expect(feed.headline).toMatchObject({
    id: "live-activity",
    kind: "activity",
    status: "running",
    title: "Senera 正在压缩上下文",
  });
  expect(feed.placeholder).toBe("Senera 正在压缩上下文");
  expect(feed.bodyText).toBe("最终回答已经生成。");
  expect(feed.footer).toBeUndefined();
});

test("workflow feed keeps concurrent child runs with the same role in separate groups", () => {
  const feed = deriveFeedModel({
    requestId: "request-concurrent-review",
    revision: 1,
    startedAt: "2026-07-10T00:00:00.000Z",
    status: "running",
    input: "Run two reviews",
    steps: ["child-run-a", "child-run-b"].map((childRunId) => ({
      id: `child-run:${childRunId}`,
      kind: "delegation",
      title: "Child agent running",
      status: "running",
      startedAt: "2026-07-10T00:00:01.000Z",
      scope: {
        parentSessionId: "session-parent",
        parentRequestId: "request-concurrent-review",
        childRunId,
        agentName: "reviewer",
        role: "childAgent",
      },
      childRun: { id: childRunId, status: "running" },
    })),
    streamingRaw: "",
    xmlPreview: "",
    visibleText: "",
    displayText: "",
    visibleKind: "unknown",
    expectedOutputMode: "open",
    decisionMode: "none",
    pendingToolArgsByName: {},
  });

  const delegationGroups = feed.groups.filter((group) => group.variant === "delegation");
  expect(delegationGroups).toHaveLength(2);
  expect(delegationGroups.map((group) => group.id)).toEqual(
    expect.arrayContaining([expect.stringContaining("child-run-a"), expect.stringContaining("child-run-b")]),
  );
});

test("workflow feed distinguishes a child run that is cancelling from active execution", () => {
  const feed = deriveFeedModel({
    requestId: "request-cancelling-child",
    revision: 1,
    startedAt: "2026-07-10T00:00:00.000Z",
    status: "running",
    input: "Stop delegated review",
    steps: [
      {
        id: "child-run:reviewer",
        kind: "delegation",
        title: "正在停止",
        description: "停止耗时较长，正在后台安全回收",
        status: "cancelling",
        startedAt: "2026-07-10T00:00:01.000Z",
        scope: {
          parentSessionId: "session-parent",
          parentRequestId: "request-cancelling-child",
          childRunId: "reviewer",
          agentName: "reviewer",
          role: "childAgent",
        },
        childRun: { id: "reviewer", status: "cancelling" },
      },
    ],
    streamingRaw: "",
    xmlPreview: "",
    visibleText: "",
    displayText: "",
    visibleKind: "unknown",
    expectedOutputMode: "open",
    decisionMode: "none",
    pendingToolArgsByName: {},
  });

  expect(feed.headline).toMatchObject({
    id: "child-run:reviewer",
    status: "cancelling",
    title: "正在停止",
  });
  expect(feed.groups.find((group) => group.variant === "delegation")?.items).toEqual([
    expect.objectContaining({ status: "cancelling" }),
  ]);
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
      facts: [
        {
          name: "temperature",
          value: "26 C",
          kind: "weather",
        },
      ],
      evidence: [
        {
          evidenceUri: "senera://evidence/weather-beijing",
          kind: "weather",
          display: "北京：晴，26 C",
          label: "北京天气",
          source: "Weather API",
          locator: "weather://beijing",
          confidence: 0.96,
        },
      ],
      changes: [
        {
          kind: "workspace",
          status: "changed",
          key: "Source/weather.ts",
          summary: "modified: Source/weather.ts",
        },
      ],
      artifactUri: "senera://artifact/weather",
    },
    toolResult: {
      type: "senera.tool_observation.v3",
      status: "success",
      execution_status: "completed",
      output_availability: "complete",
      observation_view: {
        type: "senera.tool_observation_source_view.v3",
        complete: true,
        omission_count: 0,
        omissions: [],
        artifact_uri: "senera://artifact/weather",
      },
      detail: {
        result: {
          city: "北京",
          temperature: 26,
          condition: "晴",
        },
      },
    },
  };
}
