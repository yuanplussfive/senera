import path from "node:path";
import { describe, expect, test } from "vitest";
import { EmptyAgentContinuityMemoryPromptContext } from "../../../Source/AgentSystem/Continuity/AgentContinuityMemoryTypes.js";
import {
  normalizeAgentContinuityTemplateContext,
  normalizeAgentWorkflowTemplateContext,
} from "../../../Source/AgentSystem/Prompt/AgentPromptTemplateContextNormalizer.js";
import type { AgentWorkflowPromptContext } from "../../../Source/AgentSystem/Prompt/AgentWorkflowPromptContext.js";
import { AgentPromptRenderer } from "../../../Source/AgentSystem/Prompt/AgentPromptRenderer.js";

const renderer = new AgentPromptRenderer();
const templatePath = (name: string) => path.resolve(process.cwd(), "System", "Prompts", "Templates", name);

describe("prompt template context normalization", () => {
  test("keeps strict workflow rendering safe for legacy commitments without optional fields", () => {
    const workflow = normalizeAgentWorkflowTemplateContext({
      execution: { active: null, executions: [] },
      todos: {
        items: [],
        counts: { total: 0, pending: 0, inProgress: 0, completed: 0, cancelled: 0 },
      },
      world: {
        enabled: true,
        world: { id: "world", name: "Senera", timeZone: "Asia/Shanghai" },
        time: {
          instant: "2026-09-05T12:00:00Z",
          timeZone: "Asia/Shanghai",
          localDate: "2026-09-05",
          localTime: "20:00:00",
          weekday: 6,
          weekdayLabel: "星期六",
          phaseId: "evening",
          phaseLabel: "晚上",
          dayElapsedSeconds: 72_000,
          dayElapsed: "20小时",
          dayRemainingSeconds: 14_400,
          dayRemaining: "4小时",
        },
        calendar: {
          date: "2026-09-05",
          isHoliday: true,
          isWorkday: false,
          isPublicHoliday: false,
          isPublicWorkday: false,
          holidayName: null,
          lunarSummary: "",
        },
        nodes: [],
        edges: [],
        timeline: [],
        changedNodeIds: [],
        nextSchedules: [],
        commitments: [
          {
            id: "goal-legacy",
            revision: 1,
            label: "接入 QQ 机器人",
            actorId: "user",
            actorRole: "user",
            status: "active",
            dueAt: null,
            startsAt: null,
            endsAt: null,
            detail: null,
            sourceRefs: [],
            updatedAt: null,
          },
        ],
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
    } as unknown as AgentWorkflowPromptContext);

    expect(workflow.world?.commitments[0]).toMatchObject({
      intentMode: null,
      priority: null,
      progress: null,
      successCriteria: null,
      nextReviewAt: null,
      blockedReason: null,
      statusReason: null,
      parentGoalId: null,
      ownerSessionId: null,
    });
    expect(() =>
      renderer.renderFileSync(templatePath("WorkflowContext.liquid"), {
        Workflow: workflow,
      }),
    ).not.toThrow();
  });

  test("keeps strict continuity rendering safe for graph relations without temporal bounds", () => {
    const continuity = normalizeAgentContinuityTemplateContext({
      ...EmptyAgentContinuityMemoryPromptContext,
      enabled: true,
      graphRelations: [
        {
          subject: "用户",
          subjectKind: "person",
          relationId: "likes",
          relation: "喜欢",
          object: "咖啡",
          objectKind: "item",
          temporal: {
            kind: "persistent",
            timeZone: "Asia/Shanghai",
          },
          confidence: 1,
          maturity: "active",
        },
      ],
    });

    expect(() =>
      renderer.renderFileSync(templatePath("ContinuityMemory.liquid"), {
        ContinuityMemory: continuity,
      }),
    ).not.toThrow();
  });
});
