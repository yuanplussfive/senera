import path from "node:path";
import { describe, expect, test } from "vitest";
import { AgentPromptRenderer } from "../../../Source/AgentSystem/Prompt/AgentPromptRenderer.js";
import type { AgentWorkflowPromptContext } from "../../../Source/AgentSystem/Prompt/AgentWorkflowPromptContext.js";

describe("world prompt projection", () => {
  test("renders one authoritative world state without a duplicate Agenda section", () => {
    const workflow: AgentWorkflowPromptContext = {
      execution: { active: null, executions: [] },
      todos: { items: [], counts: { total: 0, pending: 0, inProgress: 0, completed: 0, cancelled: 0 } },
      world: {
        enabled: true,
        world: { id: "world_test", name: "Senera", timeZone: "Asia/Shanghai" },
        time: {
          instant: "2026-08-29T01:30:00Z",
          timeZone: "Asia/Shanghai",
          localDate: "2026-08-29",
          localTime: "09:30:00",
          weekday: 6,
          weekdayLabel: "星期六",
          phaseId: "morning",
          phaseLabel: "上午",
          dayElapsedSeconds: 34_200,
          dayElapsed: "9小时30分钟",
          dayRemainingSeconds: 52_200,
          dayRemaining: "14小时30分钟",
        },
        calendar: {
          date: "2026-08-29",
          isHoliday: true,
          isWorkday: false,
          isPublicHoliday: false,
          isPublicWorkday: false,
          holidayName: null,
          lunarSummary: "农历七月十七",
        },
        nodes: [],
        edges: [
          {
            id: "relation_resident_home",
            subjectId: "resident",
            relation: "lives_at",
            relationLabel: null,
            objectId: "home",
            validFrom: null,
            validUntil: null,
          },
        ],
        timeline: [],
        changedNodeIds: [],
        nextSchedules: [],
        commitments: [],
        resident: {
          residentId: null,
          userId: null,
          location: null,
          activity: null,
          bodyState: null,
          emotionState: null,
          interruptedBy: null,
          relationship: null,
          nextPlan: null,
        },
      },
    };

    const rendered = new AgentPromptRenderer().renderFileSync(
      path.resolve(process.cwd(), "System", "Prompts", "Templates", "WorkflowContext.liquid"),
      { Workflow: workflow },
    );

    expect(rendered).toContain('<world_state source="senera_world_runtime">');
    expect(rendered).toContain(
      '<relation id="relation_resident_home" subject="resident" predicate="lives_at" object="home" />',
    );
    expect(rendered).not.toContain("valid_from=");
    expect(rendered).not.toContain("<world_agenda");
  });
});
