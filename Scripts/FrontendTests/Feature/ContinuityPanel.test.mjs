import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";
import { installMemoryLocalStorage, resetFrontendStore } from "../frontendStoreTestHarness.mjs";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { ContinuityPanel } from "../../../Frontend/src/features/continuity/ContinuityPanel.tsx";
import { useStore } from "../../../Frontend/src/store/sessionStore.ts";

const SessionId = "continuity-session";
const RequestId = "continuity-request";

beforeEach(() => {
  installMemoryLocalStorage();
  resetFrontendStore();
});

afterEach(() => {
  cleanup();
});

test("continuity panel shows only the context recorded for the selected run", () => {
  ingest(EventKinds.RunStarted, { input: "继续雾港的故事" }, { sequence: 1 });
  ingest(
    EventKinds.ContinuitySnapshot,
    continuitySnapshot({
      enabled: true,
      preset: {
        enabled: true,
        activePresetName: "ciello.json",
        title: "Ciello",
        corePersona: "电子插画师",
        languageStyle: "直接自然",
      },
      factCatalog: [
        {
          factKey: "user.response_style",
          claim: "先说明结论。",
          sourceRefs: ["senera://memory-source/preference"],
          confidence: 0.95,
          authority: "user_explicit",
          updatedAt: "2026-08-22T08:00:00.000Z",
          score: 0.91,
          matchedBy: ["exact_phrase"],
        },
      ],
      selection: {
        profiles: { available: 0, matched: 0, selected: 0 },
        facts: { available: 1, matched: 1, selected: 1 },
        events: { available: 0, matched: 0, selected: 0 },
        evidence: { available: 1, matched: 1, selected: 1 },
        usedCharacters: 128,
        maxCharacters: 24_000,
      },
      evidenceCandidates: [
        {
          sourceRefs: ["senera://memory-source/preference"],
          score: 0.48,
          matchedBy: ["lexical"],
        },
      ],
      rules: [
        {
          uri: "senera://continuity-rule/weather-reminder",
          title: "天气提醒",
          action: "运动完成后提醒查看天气。",
          actionKind: "notify",
          activation: "once",
          status: "partial",
          truth: "unknown",
          score: 0.5,
          threshold: 1,
          missingSignals: ["用户已完成运动"],
          conditions: [
            { label: "time >= 2026-08-29T09:00:00+08:00", truth: "true", score: 1 },
            { label: "用户已完成运动 = true", truth: "unknown", score: 0 },
          ],
          authority: "user_explicit",
          confidence: 1,
          supportCount: 2,
          maturity: "active",
        },
      ],
      signals: [],
    }),
    { sequence: 2, layer: "snapshot", phase: "prompt" },
  );
  ingest(
    EventKinds.AgendaSnapshot,
    { snapshot: agendaSnapshot({ activeGoals: [] }) },
    { sequence: 3, layer: "snapshot", phase: "prompt" },
  );
  useStore.setState({ activeSessionId: SessionId });

  renderPanel();

  expect(screen.getByTestId("continuity-panel")).toHaveTextContent("Ciello");
  expect(screen.queryByText("先说明结论。")).not.toBeInTheDocument();
  selectContinuityTab("条件");
  expect(screen.getByText("天气提醒")).toBeVisible();
  expect(screen.getByText("部分满足")).toBeVisible();
  expect(screen.getByText("1 条活动，共 1 条建模规则")).toBeVisible();
  expect(screen.getByText(/2 份独立证据.*已生效/u)).toBeVisible();
  selectContinuityTab("连接");
  expect(screen.getByText("知识连接")).toBeVisible();
  expect(screen.getAllByText("先说明结论。")[0]).toBeVisible();
  expect(screen.getAllByText("senera://memory-source/preference")).toHaveLength(2);
  openRecallInspector();
  expect(screen.getAllByText("1 已选 / 1 命中 / 1 可用")).toHaveLength(2);
});

test("continuity panel renders recall funnel diagnostics with near misses", () => {
  ingest(EventKinds.RunStarted, { input: "无糖咖啡的做法" }, { sequence: 1 });
  ingest(
    EventKinds.ContinuitySnapshot,
    continuitySnapshot({
      rejections: { belowSimilarity: 4, belowCandidate: 2, funnelSkipped: 1 },
      nearMisses: [
        {
          summary: "用户偶尔喝拿铁咖啡。",
          score: 0.21,
          textSimilarityScore: 0.18,
          lexicalScore: 0.12,
          semanticScore: 0.35,
          matchedBy: ["lexical", "embedding"],
        },
      ],
    }),
    { sequence: 2, layer: "snapshot", phase: "prompt" },
  );
  useStore.setState({ activeSessionId: SessionId });

  renderPanel();

  selectContinuityTab("连接");
  openRecallInspector();
  expect(screen.getByText("召回漏斗")).toBeVisible();
  expect(screen.getByText("低于相似度门槛：4")).toBeVisible();
  expect(screen.getByText("低于候选阈值：2")).toBeVisible();
  expect(screen.getByText("规模漏斗裁剪：1")).toBeVisible();
  expect(screen.getByText("用户偶尔喝拿铁咖啡。")).toBeVisible();
  expect(screen.getByText(/综合 21% · 相似 18% · 词汇 12% · 语义 35%/u)).toBeVisible();
});

test("continuity panel exposes the deterministic local recall plan", () => {
  ingest(EventKinds.RunStarted, { input: "球赛什么时候开始" }, { sequence: 1 });
  ingest(EventKinds.ContinuitySnapshot, continuitySnapshot(), { sequence: 2, layer: "snapshot", phase: "prompt" });
  ingest(
    EventKinds.ContinuityRecallQuery,
    {
      original: "球赛什么时候开始",
      local: {
        terms: ["球赛", "什么时候", "开始"],
        concepts: [],
        entities: [{ label: "周末球赛", kind: "event", score: 1, direct: true, matchedBy: ["token"] }],
        relations: [{ relationId: "scheduled_for", label: "安排在", score: 0.72, direct: false }],
        anchorLabels: ["周末球赛"],
        expanded: true,
      },
    },
    { sequence: 3, layer: "progress", phase: "run" },
  );
  useStore.setState({ activeSessionId: SessionId });

  renderPanel();

  selectContinuityTab("连接");
  openRecallInspector();
  expect(screen.getByText("本地规划：词项 3 · 概念 0 · 实体 1 · 关系 1 · 锚点 1")).toBeVisible();
  expect(screen.getByText("已通过实体和一跳关系扩展检索候选")).toBeVisible();
  expect(screen.getByText("直接锚点：周末球赛")).toBeVisible();
});

test("continuity panel explains why historical runs without snapshots have no context", () => {
  ingest(EventKinds.RunStarted, { input: "旧会话" }, { sequence: 1 });
  useStore.setState({ activeSessionId: SessionId });

  renderPanel();

  expect(screen.getByTestId("continuity-empty")).toHaveTextContent("这段历史对话早于连续性快照记录");
});

test("continuity panel applies the rule catalog learned after the run completes", () => {
  ingest(EventKinds.RunStarted, { input: "运动后提醒我看天气" }, { sequence: 1 });
  ingest(
    EventKinds.ContinuitySnapshot,
    continuitySnapshot({
      enabled: true,
      preset: { enabled: false, activePresetName: null },
      evidenceCandidates: [],
      rules: [],
      signals: [],
    }),
    { sequence: 2, layer: "snapshot", phase: "prompt" },
  );
  ingest(EventKinds.RunCompleted, {}, { sequence: 3, layer: "terminal", phase: "run" });
  ingest(
    EventKinds.ContinuityRulesSnapshot,
    {
      rules: [
        {
          uri: "senera://continuity-rule/exercise-weather-reminder",
          title: "运动后天气提醒",
          action: "提醒用户查看天气。",
          actionKind: "notify",
          activation: "once",
          status: "partial",
          truth: "unknown",
          score: 0.5,
          threshold: 1,
          missingSignals: ["用户已完成运动"],
          conditions: [{ label: "用户已完成运动 = true", truth: "unknown", score: 0 }],
          authority: "user_explicit",
          confidence: 1,
          supportCount: 1,
          maturity: "active",
          validUntil: "2026-08-30T01:00:00.000Z",
        },
      ],
      signals: [
        {
          uri: "senera://continuity-state/state_bbbbbbbbbbbbbbbbbbbbbbbb",
          summary: "下雨概率",
          valueJson: "0.7",
          valueType: "number",
          observedAt: "2026-08-23T01:00:03.000Z",
        },
      ],
    },
    { sequence: 4, layer: "snapshot", phase: "prompt" },
  );
  useStore.setState({ activeSessionId: SessionId });

  renderPanel();

  selectContinuityTab("条件");
  expect(screen.getByText("运动后天气提醒")).toBeVisible();
  expect(screen.getByText("下雨概率")).toBeVisible();
  expect(screen.getByText("0.7")).toBeVisible();
  expect(screen.getByText(/2026.*08.*30/u)).toBeInTheDocument();
});

test("continuity panel keeps durable Agenda goals separate from session execution", () => {
  ingest(EventKinds.RunStarted, { input: "继续后台任务" }, { sequence: 1 });
  ingest(
    EventKinds.ContinuitySnapshot,
    continuitySnapshot({
      enabled: true,
      preset: { enabled: false, activePresetName: null },
      evidenceCandidates: [],
      rules: [],
      signals: [],
    }),
    { sequence: 2, layer: "snapshot", phase: "prompt" },
  );
  ingest(
    EventKinds.AgendaSnapshot,
    {
      snapshot: agendaSnapshot({
        activeGoals: [
          agendaRecord({
            id: "agenda-goal-1",
            kind: "goal",
            summary: "完成项目迁移",
            status: "active",
          }),
        ],
      }),
    },
    { sequence: 3, layer: "snapshot", phase: "prompt" },
  );
  useStore.setState({ activeSessionId: SessionId });

  renderPanel();

  selectContinuityTab("世界");
  expect(screen.getByText("完成项目迁移")).toBeVisible();
  expect(screen.getByText("长期目标")).toBeVisible();
  expect(screen.getByText("本轮没有正在追踪的执行步骤")).toBeVisible();
});

test("continuity panel renders the global Agenda before the first run", () => {
  useStore.getState().registerCreatingSession(SessionId);
  useStore.getState().ingest({
    channel: "agent.event",
    kind: EventKinds.AgendaSnapshot,
    layer: "snapshot",
    phase: "prompt",
    sequence: 1,
    timestamp: "2026-08-22T08:00:00.000Z",
    data: {
      snapshot: agendaSnapshot({
        activeGoals: [agendaRecord({ id: "agenda-goal-before-run", summary: "准备本周迁移" })],
      }),
    },
  });
  useStore.setState({ activeSessionId: SessionId });

  renderPanel();

  selectContinuityTab("世界");
  expect(screen.getByText("准备本周迁移")).toBeVisible();
});

test("continuity panel does not manufacture Agenda goals from an execution trace", () => {
  ingest(EventKinds.RunStarted, { input: "查看旧会话" }, { sequence: 1 });
  ingest(
    EventKinds.ContinuitySnapshot,
    continuitySnapshot({
      enabled: true,
      preset: { enabled: false, activePresetName: null },
      evidenceCandidates: [],
      rules: [],
      signals: [],
    }),
    { sequence: 2, layer: "snapshot", phase: "prompt" },
  );
  ingest(
    EventKinds.AgendaSnapshot,
    { snapshot: agendaSnapshot() },
    { sequence: 3, layer: "snapshot", phase: "prompt" },
  );
  useStore.setState({ activeSessionId: SessionId });

  renderPanel();

  selectContinuityTab("世界");
  expect(screen.getByTestId("continuity-panel")).toBeVisible();
  expect(screen.getByText("长期目标")).toBeVisible();
  expect(screen.getByText("暂无持续目标")).toBeVisible();
});

test("continuity panel presents hierarchical temporal digest health and latest summaries", () => {
  ingest(EventKinds.RunStarted, { input: "回忆最近内容" }, { sequence: 1 });
  ingest(
    EventKinds.ContinuitySnapshot,
    continuitySnapshot({
      temporalMemory: {
        counts: [
          { granularity: "segment", status: "sealed", count: 8 },
          { granularity: "day", status: "sealed", count: 3 },
          { granularity: "month", status: "sealed", count: 1 },
          { granularity: "segment", status: "pending", count: 1 },
        ],
        segmentDecisions: [],
        latestSealed: [
          {
            uri: "senera://memory-digest/month-2026-08",
            granularity: "month",
            periodStart: "2026-07-31T16:00:00.000Z",
            periodEnd: "2026-08-31T16:00:00.000Z",
            timeZone: "Asia/Shanghai",
            summary: "八月主要讨论了世界树与记忆检索的重构。",
            topics: ["世界树", "记忆检索"],
            openLoops: ["继续验证长期召回"],
            sourceCount: 3,
          },
        ],
      },
    }),
    { sequence: 2, layer: "snapshot", phase: "prompt" },
  );
  ingest(
    EventKinds.AgendaSnapshot,
    { snapshot: agendaSnapshot() },
    { sequence: 3, layer: "snapshot", phase: "prompt" },
  );
  useStore.setState({ activeSessionId: SessionId });

  renderPanel();
  selectContinuityTab("世界");

  expect(screen.getByText("概括记忆")).toBeVisible();
  expect(screen.getByText("已封存：8 个片段 · 3 天 · 1 个月")).toBeVisible();
  expect(screen.getByText("处理中 1 · 失败 0")).toBeVisible();
  expect(screen.getByText("八月主要讨论了世界树与记忆检索的重构。")).toBeVisible();
  expect(screen.getByText("3 个直接来源")).toBeVisible();
});

function renderPanel(send = vi.fn(() => true)) {
  return renderWithFrontendProviders(React.createElement(ContinuityPanel, { send, connected: true }));
}

function selectContinuityTab(name) {
  fireEvent.click(screen.getByRole("tab", { name }));
}

function openRecallInspector() {
  fireEvent.click(screen.getByText("查看召回审计与证据"));
}

function continuitySnapshot(overrides = {}) {
  return {
    enabled: true,
    concepts: [],
    residentProfile: [],
    factCatalog: [],
    selection: {
      profiles: { available: 0, matched: 0, selected: 0 },
      facts: { available: 0, matched: 0, selected: 0 },
      events: { available: 0, matched: 0, selected: 0 },
      evidence: { available: 0, matched: 0, selected: 0 },
      usedCharacters: 0,
      maxCharacters: 24_000,
    },
    preset: { enabled: false, activePresetName: null },
    evidenceCandidates: [],
    eventCandidates: [],
    rules: [],
    signals: [],
    execution: { active: null, executions: [] },
    todos: {
      items: [],
      counts: { total: 0, pending: 0, inProgress: 0, completed: 0, cancelled: 0 },
    },
    ...overrides,
  };
}

function agendaSnapshot(overrides = {}) {
  const empty = {
    world: {
      id: "world-1",
      uri: "senera://world/world-1",
      timeZone: "Asia/Shanghai",
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T08:00:00.000Z",
    },
    clock: {
      instant: "2026-08-22T08:00:00.000Z",
      timeZone: "Asia/Shanghai",
      localDate: "2026-08-22",
      localTime: "16:00:00",
      weekdayLabel: "星期六",
    },
    records: [],
    activeGoals: [],
    currentActivities: [],
    timeline: [],
    upcoming: [],
  };
  return { ...empty, ...overrides, records: overrides.records ?? overrides.activeGoals ?? empty.records };
}

function agendaRecord(overrides = {}) {
  return {
    id: "agenda-record-1",
    revision: 1,
    uri: "senera://agenda/agenda-record-1",
    worldId: "world-1",
    actorId: "agenda-actor-user",
    kind: "goal",
    actor: {
      id: "agenda-actor-user",
      uri: "senera://agenda-actor/agenda-actor-user",
      worldId: "world-1",
      role: "user",
      createdAt: "2026-08-22T00:00:00.000Z",
    },
    summary: "长期目标",
    status: "active",
    dueAt: null,
    startsAt: null,
    endsAt: null,
    relatedRecordId: null,
    detail: null,
    sourceRefs: ["senera://memory-source/user"],
    createdAt: "2026-08-22T08:00:00.000Z",
    updatedAt: "2026-08-22T08:00:00.000Z",
    lastEventId: "agenda-event-1",
    ...overrides,
  };
}

function ingest(kind, data, overrides = {}) {
  useStore.getState().ingest({
    channel: "agent.event",
    kind,
    layer: overrides.layer ?? "progress",
    phase: overrides.phase ?? "run",
    sequence: overrides.sequence ?? 1,
    timestamp: "2026-08-22T08:00:00.000Z",
    sessionId: SessionId,
    requestId: RequestId,
    data,
  });
}
