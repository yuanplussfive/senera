import path from "node:path";
import { describe, expect, test } from "vitest";
import type { AgentWorldPromptContext } from "../../../Source/AgentSystem/World/AgentWorldPromptContext.js";
import { AgentPromptRenderer } from "../../../Source/AgentSystem/Prompt/AgentPromptRenderer.js";
import {
  EmptyAgentSceneContext,
  compileAgentSceneContext,
} from "../../../Source/AgentSystem/Prompt/AgentSceneContextCompiler.js";

function worldContext(overrides: Partial<AgentWorldPromptContext> = {}): AgentWorldPromptContext {
  return {
    enabled: true,
    world: { id: "world", name: "测试世界", timeZone: "Asia/Shanghai" },
    time: {
      instant: "2026-09-01T09:00:00Z",
      timeZone: "Asia/Shanghai",
      localDate: "2026-09-01",
      localTime: "17:00:00",
      weekday: 2,
      weekdayLabel: "星期二",
      phaseId: "afternoon",
      phaseLabel: "下午",
      dayElapsedSeconds: 61200,
      dayElapsed: "17小时",
      dayRemainingSeconds: 25200,
      dayRemaining: "7小时",
    },
    calendar: {
      date: "2026-09-01",
      isHoliday: false,
      isWorkday: true,
      isPublicHoliday: false,
      isPublicWorkday: true,
      holidayName: null,
      lunarSummary: "",
    },
    nodes: [],
    edges: [],
    timeline: [],
    changedNodeIds: [],
    nextSchedules: [],
    commitments: [],
    resident: {
      residentId: "resident",
      userId: "user",
      location: "工作室",
      activity: "整理画稿",
      bodyState: null,
      emotionState: "专注",
      interruptedBy: null,
      relationship: "熟悉的聊天对象",
      nextPlan: {
        scheduleId: "schedule-1",
        label: "晚饭",
        at: "2026-09-01T18:30:00+08:00",
        actorId: "resident",
        actorRole: "resident",
        kind: "schedule",
        source: "agenda",
      },
    },
    ...overrides,
  };
}

describe("agent scene context compiler", () => {
  test("projects present focus and the latest recorded event", () => {
    const context = compileAgentSceneContext({
      world: worldContext({
        timeline: [
          {
            id: "older",
            type: "conversation.completed",
            occurredAt: "2026-09-01T08:00:00.000Z",
            summary: "早上的对话已经结束。",
            source: "senera://event/older",
            changedEntityIds: [],
          },
          {
            id: "newer",
            type: "tool.completed",
            occurredAt: "2026-09-01T08:05:00.000Z",
            summary: "资料查询完成。",
            source: "senera://event/newer",
            changedEntityIds: [],
          },
        ],
      }),
    });

    expect(context).toEqual({
      enabled: true,
      attention: { source: "activity", text: "整理画稿" },
      moment: {
        worldName: "测试世界",
        timeZone: "Asia/Shanghai",
        instant: "2026-09-01T09:00:00Z",
        localDate: "2026-09-01",
        localTime: "17:00:00",
        weekdayLabel: "星期二",
        phaseLabel: "下午",
        dayElapsed: "17小时",
        dayRemaining: "7小时",
      },
      current: {
        location: "工作室",
        activity: "整理画稿",
        bodyState: null,
        emotionState: "专注",
        relationship: "熟悉的聊天对象",
        interruptedBy: null,
        nextPlan: { label: "晚饭", at: "2026-09-01T18:30:00+08:00", kind: "schedule" },
      },
      recentEvent: {
        type: "tool.completed",
        occurredAt: "2026-09-01T08:05:00.000Z",
        summary: "资料查询完成。",
      },
    });
  });

  test("does not invent a scene when no world snapshot exists", () => {
    expect(compileAgentSceneContext({ world: null })).toBe(EmptyAgentSceneContext);
  });

  test("anchors the scene on an interruption before the resident's ongoing activity", () => {
    const baseResident = worldContext().resident;
    const context = compileAgentSceneContext({
      world: worldContext({
        resident: {
          ...baseResident,
          interruptedBy: "刚刚收到一条新消息",
        },
      }),
    });

    expect(context.attention).toEqual({ source: "interruption", text: "刚刚收到一条新消息" });
  });

  test("keeps the physical moment as an explicit anchor when no scene event exists", () => {
    const context = compileAgentSceneContext({
      world: worldContext({
        timeline: [],
        resident: {
          residentId: null,
          userId: null,
          location: null,
          activity: null,
          bodyState: null,
          emotionState: null,
          relationship: null,
          interruptedBy: null,
          nextPlan: null,
        },
      }),
    });

    expect(context.attention).toEqual({ source: "moment", text: "2026-09-01 17:00:00 下午" });
  });

  test("renders the current moment as the scene entry", () => {
    const scene = compileAgentSceneContext({ world: worldContext() });
    const rendered = new AgentPromptRenderer().renderFileSync(
      path.resolve(process.cwd(), "System", "Prompts", "Templates", "SceneContext.liquid"),
      { Scene: scene },
    );

    expect(rendered).toContain('<scene_entry attribution="world" priority="immediate">');
    expect(rendered).toContain('world="测试世界"');
    expect(rendered).toContain('date="2026-09-01"');
    expect(rendered).toContain('<attention source="activity">整理画稿</attention>');
    expect(rendered).toContain("<activity>整理画稿</activity>");
    expect(rendered).toContain("<response_anchor>");
  });
});
