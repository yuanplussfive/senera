import { encode as encodeToon } from "@toon-format/toon";
import { describe, expect, test } from "vitest";
import {
  renderAgentContinuityFactsPromptWire,
  renderAgentContinuityPromptWire,
  decodeAgentPromptInputWire,
  decodeAgentPromptWire,
  renderAgentPromptWireBlocks,
  renderAgentPromptContextWires,
  renderAgentResidentProfilePromptWire,
  renderAgentScenePromptWire,
  renderAgentWorkflowPromptWire,
  type AgentPromptWireBlockDescriptor,
} from "../../../Source/AgentSystem/Prompt/AgentPromptContextWireRenderer.js";
import { compileAgentSceneContext } from "../../../Source/AgentSystem/Prompt/AgentSceneContextCompiler.js";
import {
  EmptyAgentContinuityMemoryPromptContext,
  type AgentContinuityMemoryPromptContext,
} from "../../../Source/AgentSystem/Continuity/AgentContinuityMemoryTypes.js";
import type { AgentWorkflowPromptContext } from "../../../Source/AgentSystem/Prompt/AgentWorkflowPromptContext.js";
import { EmptyAgentDelegationPromptContext } from "../../../Source/AgentSystem/Orchestration/AgentDelegationPromptContext.js";

const emptyWorkflow = (): AgentWorkflowPromptContext => ({
  execution: { active: null, executions: [] },
  todos: {
    items: [
      {
        id: "todo-1",
        content: "保留分隔符 , | 和换行\n文本",
        status: "pending",
        order: 1,
        createdAt: "2026-09-12T00:00:00.000Z",
        updatedAt: "2026-09-12T00:00:00.000Z",
      },
    ],
    counts: { total: 1, pending: 1, inProgress: 0, completed: 0, cancelled: 0 },
  },
  world: null,
  delegation: EmptyAgentDelegationPromptContext,
});

describe("agent prompt context wire renderer", () => {
  test("selects the measured representation and preserves a lossless block", () => {
    const value = { items: Array.from({ length: 20 }, (_, index) => ({ id: `t${index}`, status: "pending" })) };
    const descriptors: AgentPromptWireBlockDescriptor[] = [
      { id: "todos", value, allowedEncodings: ["toon", "compact-json"] },
    ];
    const wire = renderAgentPromptWireBlocks(
      { preamble: ["senera.test=v1"], blocks: descriptors },
      { estimateTokens: (text) => text.length },
    );
    const selected = wire.blocks[0];
    expect(selected.tokenCount).toBe(Math.min(encodeToon(value).length, JSON.stringify(value).length));
    expect(wire.text).toContain(`[senera.todos] encoding=${selected.encoding}`);
    expect(wire.complete).toBe(true);
    expect(wire.sourceRevision).toHaveLength(64);
  });

  test("uses canonical compact JSON when it is the selected representation", () => {
    const wire = renderAgentPromptWireBlocks(
      {
        preamble: ["senera.test=v1"],
        blocks: [{ id: "state", value: { z: 3, a: 1 }, allowedEncodings: ["compact-json"] }],
      },
      { estimateTokens: (text) => text.length },
    );

    expect(wire.blocks[0]?.encoding).toBe("compact-json");
    expect(wire.text).toContain('{"a":1,"z":3}');
    expect(wire.text).not.toContain("\n  ");
    expect(wire.text).not.toContain('{ "z"');
  });

  test("projects workflow ledgers without XML duplication", () => {
    const wire = renderAgentWorkflowPromptWire(emptyWorkflow(), { estimateTokens: (text) => text.length });
    expect(wire.complete).toBe(true);
    expect(wire.text).toContain("senera.workflow=v1");
    expect(wire.text).toContain("[senera.todos]");
    expect(wire.text).not.toContain("<workflow_context");
    expect(wire.text).toContain("todo-1");
    expect(wire.blocks.map((block) => block.id)).toEqual(["todos"]);
  });

  test("does not add a workflow envelope when there is no volatile workflow state", () => {
    const wire = renderAgentWorkflowPromptWire(
      {
        execution: { active: null, executions: [] },
        todos: { items: [], counts: { total: 0, pending: 0, inProgress: 0, completed: 0, cancelled: 0 } },
        world: null,
        delegation: EmptyAgentDelegationPromptContext,
      },
      { estimateTokens: (text) => text.length },
    );
    expect(wire.text).toBe("");
    expect(wire.blocks).toHaveLength(0);
    expect(wire.tokenCount).toBe(0);
  });

  test("rejects a block when its declared encoding cannot round-trip", () => {
    expect(() =>
      renderAgentPromptWireBlocks(
        {
          preamble: [],
          blocks: [
            {
              id: "broken",
              value: { answer: BigInt(1) },
              allowedEncodings: ["compact-json"],
            },
          ],
        },
        { estimateTokens: (text) => text.length },
      ),
    ).toThrow();
  });

  test("orders object keys deterministically for both encodings", () => {
    const first = renderAgentPromptWireBlocks(
      {
        preamble: ["senera.test=v1"],
        blocks: [{ id: "state", value: { z: { b: 2, a: 1 }, a: 0 }, allowedEncodings: ["toon"] }],
      },
      { estimateTokens: (text) => text.length },
    );
    const second = renderAgentPromptWireBlocks(
      {
        preamble: ["senera.test=v1"],
        blocks: [{ id: "state", value: { a: 0, z: { a: 1, b: 2 } }, allowedEncodings: ["toon"] }],
      },
      { estimateTokens: (text) => text.length },
    );

    expect(first.text).toBe(second.text);
    expect(first.sourceRevision).toBe(second.sourceRevision);
  });

  test("rejects circular values and input wires with the wrong kind", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() =>
      renderAgentPromptWireBlocks(
        { preamble: ["senera.test=v1"], blocks: [{ id: "state", value: circular, allowedEncodings: ["toon"] }] },
        { estimateTokens: (text) => text.length },
      ),
    ).toThrow(/circular references/u);

    const wire = renderAgentPromptWireBlocks(
      {
        preamble: ["senera.other=v1"],
        blocks: [
          { id: "directive", value: { stage: "test" }, allowedEncodings: ["compact-json"] },
          { id: "context", value: {}, allowedEncodings: ["compact-json"] },
        ],
      },
      { estimateTokens: (text) => text.length },
    ).text;
    expect(() => decodeAgentPromptInputWire(wire, { expectedKind: "planner_input" })).toThrow(/kind mismatch/u);
    expect(() => decodeAgentPromptWire(wire, { expectedKind: "planner_input" })).toThrow(/kind mismatch/u);
  });

  test("uses the same lossless builders for standalone scene and continuity templates", () => {
    const scene = compileAgentSceneContext({
      world: {
        enabled: true,
        world: { id: "world", name: "工作室", timeZone: "Asia/Shanghai" },
        time: {
          instant: "2026-09-12T00:00:00.000Z",
          timeZone: "Asia/Shanghai",
          localDate: "2026-09-12",
          localTime: "08:00:00",
          weekday: 6,
          weekdayLabel: "星期六",
          phaseId: "morning",
          phaseLabel: "上午",
          dayElapsedSeconds: 28800,
          dayElapsed: "8小时",
          dayRemainingSeconds: 57600,
          dayRemaining: "16小时",
        },
        calendar: {
          date: "2026-09-12",
          isHoliday: false,
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
        commitments: [],
        resident: {
          residentId: "resident",
          userId: "user",
          location: "书桌",
          activity: "阅读",
          bodyState: null,
          emotionState: null,
          relationship: null,
          interruptedBy: null,
          nextPlan: null,
        },
      },
    });
    const memory = {
      ...EmptyAgentContinuityMemoryPromptContext,
      enabled: true,
      pendingRuleDeliveryUris: [],
      residentProfile: [
        {
          subject: "user" as const,
          key: "语言",
          valueJson: JSON.stringify("中文"),
          claim: "语言: 中文",
          validUntil: "",
          sourceRefs: ["senera://memory-source/language"],
        },
      ],
      factCatalog: [
        {
          factKey: "fact-1",
          claim: "用户正在测试 wire。",
          sourceRefs: ["senera://memory-source/fact-1"],
          confidence: 1,
          authority: "user_explicit" as const,
          validFrom: "2026-09-12T00:00:00.000Z",
          updatedAt: "2026-09-12T00:00:00.000Z",
          supportCount: 1,
          supportMass: 1,
          maturity: "active" as const,
          score: 1,
          matchedBy: ["exact_phrase"],
        },
      ],
      graphRelations: [],
      evidenceCandidates: [],
      eventCandidates: [],
      activeRules: [],
      ruleCatalog: [],
      signals: [],
      selection: {
        profiles: { selected: 1, matched: 1, available: 1 },
        facts: { selected: 1, matched: 1, available: 1 },
        relations: { selected: 0, matched: 0, available: 0 },
        events: { selected: 0, matched: 0, available: 0 },
        evidence: { selected: 0, matched: 0, available: 0 },
        usedCharacters: 0,
        maxCharacters: 1000,
      },
    } satisfies AgentContinuityMemoryPromptContext;
    const options = { estimateTokens: (text: string) => text.length };
    const sceneWire = renderAgentScenePromptWire(scene, options);
    const continuityWire = renderAgentContinuityPromptWire(memory, options);
    const factsWire = renderAgentContinuityFactsPromptWire(memory, options);
    const profileWire = renderAgentResidentProfilePromptWire(memory, options);
    const wireSet = renderAgentPromptContextWires(
      {
        scene,
        continuity: memory,
        workflow: emptyWorkflow(),
      },
      options,
    );

    expect(sceneWire.text).toContain("senera.scene=v1");
    expect(sceneWire.text).toContain("[senera.scene]");
    expect(sceneWire.text).toContain("书桌");
    expect(continuityWire.text).toContain("senera.continuity=v1");
    expect(continuityWire.text).toContain("[senera.profile]");
    expect(continuityWire.text).toContain("[senera.facts]");
    expect(factsWire.text).toContain("senera.continuity_facts=v1");
    expect(factsWire.text).toContain("[senera.facts]");
    expect(profileWire.text).toContain("senera.resident_profile=v1");
    expect(profileWire.text).toContain("[senera.profile]");
    expect(factsWire.text).not.toContain("[senera.profile]");
    expect(profileWire.text).not.toContain("[senera.facts]");
    expect(wireSet.scene.text).toBe(sceneWire.text);
    expect(wireSet.continuity.text).toBe(continuityWire.text);
    expect(wireSet.continuityFacts.text).toBe(factsWire.text);
    expect(wireSet.residentProfile.text).toBe(profileWire.text);
    expect(wireSet.workflow.text).toContain("senera.workflow=v1");
    expect(wireSet.volatile.text).toContain("senera.context=v1");
  });
});
