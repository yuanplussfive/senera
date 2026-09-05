import { describe, expect, test } from "vitest";
import { AgentContinuityCandidateCompiler } from "../../../Source/AgentSystem/Continuity/AgentContinuityCandidateCompiler.js";
import {
  parseAgentContinuityFactExtraction,
  parseAgentContinuityRuleExtraction,
} from "../../../Source/AgentSystem/Continuity/AgentContinuityLearningSchema.js";
import {
  buildAgentContinuityFactPromptInput,
  buildAgentContinuityRulePromptInput,
} from "../../../Source/AgentSystem/Continuity/AgentContinuityLearningPromptProjector.js";
import { AgentContinuityRelationCatalog } from "../../../Source/AgentSystem/Continuity/AgentContinuityRelationCatalog.js";
import { createAgentContinuitySemanticStateIdentity } from "../../../Source/AgentSystem/Continuity/AgentContinuityStateIdentity.js";
import type {
  AgentMemoryEpisodeRecord,
  AgentMemoryRecordedTurn,
  AgentMemorySourceRecord,
} from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import { testContinuityIdentity } from "./AgentContinuityTestFixtures.js";

describe("continuity candidate compiler", () => {
  test("keeps capture output shallow and host-owned", () => {
    expect(
      parseAgentContinuityFactExtraction({
        items: [
          { kind: "fact", text: "用户偏好先给结论。" },
          { kind: "fact", text: " 用户偏好先给结论。 " },
        ],
        agenda: [],
        needsRulePass: false,
      }),
    ).toEqual({ items: [{ kind: "fact", text: "用户偏好先给结论。" }], agenda: [], needsRulePass: false });
    expect(() =>
      parseAgentContinuityFactExtraction({
        items: [{ kind: "fact", text: "用户偏好先给结论。" }],
        agenda: [],
        needsRulePass: false,
        evidence: [0],
      }),
    ).toThrow();
  });

  test("accepts only exact catalog ids for model-created relations", () => {
    const relation = AgentContinuityRelationCatalog.find(({ id }) => id === "depends_on");
    if (!relation) throw new Error("Expected depends_on relation in the continuity catalog.");

    expect(() =>
      parseAgentContinuityFactExtraction({
        items: [{ kind: "relation", from: "球赛", relation: relation.label, to: "天气" }],
        agenda: [],
        needsRulePass: false,
      }),
    ).toThrow(`Unknown continuity relation: ${relation.label}`);
    expect(
      parseAgentContinuityFactExtraction({
        items: [{ kind: "relation", from: "球赛", relation: relation.id, to: "天气" }],
        agenda: [],
        needsRulePass: false,
      }),
    ).toEqual({
      items: [{ kind: "relation", from: "球赛", relation: relation.id, to: "天气" }],
      agenda: [],
      needsRulePass: false,
    });
  });

  test("requires every requested modeling pass to produce a typed item", () => {
    expect(() =>
      parseAgentContinuityRuleExtraction({
        items: [],
      }),
    ).toThrow("Too small: expected array to have >=1 items");
    expect(() =>
      parseAgentContinuityRuleExtraction({
        items: [{ kind: "conditional", title: "天气提醒", effect: "提醒用户查看天气。", until: "permanent" }],
      }),
    ).toThrow("needs when or at");
  });

  test("compiles facts independently from condition state and rules", () => {
    const compiler = new AgentContinuityCandidateCompiler({
      identity: testContinuityIdentity("E:\\workspace"),
      recordedTurn: recordedTurn(),
      observedAt: "2026-08-23T01:00:02.000Z",
    });
    const facts = parseAgentContinuityFactExtraction({
      items: [
        { kind: "fact", text: "用户偏好先给结论。" },
        { kind: "fact", text: "用户要求在完成运动后提醒查看天气。" },
        { kind: "profile", key: "居住地点", value: "上海" },
        { kind: "agent_profile", key: "回复风格", value: "简洁" },
        { kind: "relation", from: "运动", relation: "depends_on", to: "天气" },
      ],
      agenda: [],
      needsRulePass: true,
    });
    const factBatch = compiler.compileFacts(facts);

    expect(factBatch.observations).toHaveLength(2);
    expect(factBatch.observations[0]).toMatchObject({
      kind: "learning.record",
      payload: { kind: "fact", fact: "用户偏好先给结论。" },
      scope: { kind: "user", id: "E:\\workspace" },
    });
    expect(factBatch.observations.flatMap((entry) => entry.sourceRefs)).not.toContain(
      "senera://memory-source/assistant",
    );
    expect(factBatch.profiles).toEqual([
      expect.objectContaining({
        subject: "user",
        key: "居住地点",
        value: "上海",
        scope: { kind: "user", id: "E:\\workspace" },
      }),
      expect.objectContaining({
        subject: "agent",
        key: "回复风格",
        value: "简洁",
        scope: { kind: "world", id: "E:\\workspace" },
      }),
    ]);
    expect(factBatch.relations).toEqual([
      expect.objectContaining({
        subjectLabel: "运动",
        relationId: "depends_on",
        objectLabel: "天气",
      }),
    ]);
    expect(factBatch.facts).toContain("运动 依赖 天气");

    const conditionBatch = compiler.compileRules(
      parseAgentContinuityRuleExtraction({
        items: [
          { kind: "state", title: "用户已完成运动", value: true, until: "session" },
          { kind: "always", title: "保持简短回复", effect: "回复简短自然，减少非必要符号。", until: "permanent" },
          {
            kind: "notify",
            title: "运动后天气提醒",
            match: "score",
            threshold: 0.6,
            at: "2026-08-29T09:00:00+08:00",
            when: {
              用户已完成运动: true,
              下雨概率不低于六成: true,
            },
            effect: "提醒用户查看天气。",
            until: "2026-08-30T09:00:00+08:00",
          },
        ],
      }),
      { statesByUri: new Map() },
    );

    expect(conditionBatch.signals).toEqual([
      expect.objectContaining({
        namespace: "semantic",
        key: "用户已完成运动",
        value: true,
        scope: { kind: "session", id: "session-1" },
      }),
    ]);
    expect(conditionBatch.rules).toHaveLength(2);
    expect(conditionBatch.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "保持简短回复",
          condition: { kind: "always" },
          action: { kind: "recall", summary: "回复简短自然，减少非必要符号。", activation: "while_true" },
        }),
        expect.objectContaining({
          title: "运动后天气提醒",
          action: { kind: "notify", summary: "提醒用户查看天气。", activation: "once" },
          sourceRefs: expect.arrayContaining(["senera://memory-source/user"]),
          temporal: {
            kind: "interval",
            endsAt: "2026-08-30T01:00:00.000Z",
            timeZone: "Asia/Shanghai",
          },
          condition: {
            kind: "score",
            threshold: 0.6,
            children: expect.arrayContaining([
              { kind: "time_at_or_after", at: "2026-08-29T01:00:00.000Z" },
              expect.objectContaining({ namespace: "semantic", key: "用户已完成运动", value: true }),
              expect.objectContaining({ namespace: "semantic", key: "下雨概率不低于六成", value: true }),
            ]),
          },
        }),
      ]),
    );

    const persistentRule = compiler.compileRules(
      parseAgentContinuityRuleExtraction({
        items: [
          { kind: "always", title: "保持简短回复", effect: "回复简短自然，减少非必要符号。", until: "permanent" },
        ],
      }),
      { statesByUri: new Map() },
    ).rules[0];
    expect(persistentRule).toMatchObject({
      title: "保持简短回复",
      scope: { kind: "workspace", id: "E:\\workspace" },
      temporal: { kind: "persistent", timeZone: "Asia/Shanghai" },
    });
  });

  test("removes only an exact profile echo from the ordinary fact ledger", () => {
    const compiler = new AgentContinuityCandidateCompiler({
      identity: testContinuityIdentity("E:\\workspace"),
      recordedTurn: recordedTurn(),
      observedAt: "2026-08-23T01:00:02.000Z",
    });

    const batch = compiler.compileFacts(
      parseAgentContinuityFactExtraction({
        items: [
          { kind: "fact", text: "居住地点: 上海" },
          { kind: "fact", text: "用户偏好先给结论。" },
          { kind: "profile", key: "居住地点", value: "上海" },
        ],
        agenda: [],
        needsRulePass: false,
      }),
    );

    expect(batch.profiles).toHaveLength(1);
    expect(batch.observations.map((entry) => entry.summary)).toEqual(["用户偏好先给结论。"]);
  });

  test("preserves a qualified fact when a profile would omit its meaning", () => {
    const turn = recordedTurn();
    turn.episode.rawUserText = "我不喜欢过桥米线里的辣椒，因为不好吃。";
    turn.sources = turn.sources.map((entry) =>
      entry.sourceKind === "user_message"
        ? {
            ...entry,
            textContent: turn.episode.rawUserText,
            summary: turn.episode.rawUserText,
          }
        : entry,
    );
    const batch = new AgentContinuityCandidateCompiler({
      identity: testContinuityIdentity("E:\\workspace"),
      recordedTurn: turn,
      observedAt: "2026-08-23T01:00:02.000Z",
    }).compileFacts(
      parseAgentContinuityFactExtraction({
        items: [
          { kind: "fact", text: "用户认为过桥米线里的辣椒不好吃。" },
          { kind: "profile", key: "不喜欢的食物成分", value: "辣椒" },
        ],
        agenda: [],
        needsRulePass: false,
      }),
    );

    expect(batch.observations.map((entry) => entry.summary)).toContain("用户认为过桥米线里的辣椒不好吃。");
  });

  test("links physical evidence without accepting model-managed evidence fields", () => {
    expect(() =>
      parseAgentContinuityFactExtraction({
        items: [{ kind: "fact", text: "用户偏好简洁回答。" }],
        agenda: [],
        needsRulePass: false,
        evidence: [0],
      }),
    ).toThrow();

    const batch = new AgentContinuityCandidateCompiler({
      identity: testContinuityIdentity("E:\\workspace"),
      recordedTurn: recordedTurn(),
      observedAt: "2026-08-23T01:00:02.000Z",
    }).compileFacts(
      parseAgentContinuityFactExtraction({
        items: [{ kind: "fact", text: "用户偏好简洁回答。" }],
        agenda: [],
        needsRulePass: false,
      }),
    );

    expect(batch.observations[0]?.sourceRefs.length).toBeGreaterThan(0);
    expect(batch.observations[0]?.sourceRefs).not.toContain("senera://memory-source/assistant");
  });

  test("rejects a model fact that cannot be grounded in user or tool evidence", () => {
    const compiler = new AgentContinuityCandidateCompiler({
      identity: testContinuityIdentity("E:\\workspace"),
      recordedTurn: recordedTurn(),
      observedAt: "2026-08-23T01:00:02.000Z",
    });

    expect(() =>
      compiler.compileFacts(
        parseAgentContinuityFactExtraction({
          items: [{ kind: "fact", text: "The archival theorem was proven on Mars." }],
          agenda: [],
          needsRulePass: false,
        }),
      ),
    ).toThrow("not grounded in the episode sources");
  });

  test("updates an existing semantic state only through a supplied Senera URI", () => {
    const scope = { kind: "workspace" as const, id: "E:\\workspace" };
    const state = createAgentContinuitySemanticStateIdentity("用户已完成运动", scope);
    const compiler = new AgentContinuityCandidateCompiler({
      identity: testContinuityIdentity(scope.id),
      recordedTurn: recordedTurn(),
      observedAt: "2026-08-23T01:00:02.000Z",
    });
    const extraction = parseAgentContinuityRuleExtraction({
      items: [{ kind: "state", title: "运动完成状态", target: state.uri, value: true, until: "permanent" }],
    });

    expect(compiler.compileRules(extraction, { statesByUri: new Map([[state.uri, state]]) }).signals[0]).toMatchObject({
      namespace: "semantic",
      key: "用户已完成运动",
      value: true,
    });
    expect(() => compiler.compileRules(extraction, { statesByUri: new Map() })).toThrow(
      "Unknown continuity state reference",
    );
  });

  test("assigns distinct host identities to the same state in different scopes", () => {
    const workspaceState = createAgentContinuitySemanticStateIdentity("用户已完成运动", {
      kind: "workspace",
      id: "E:\\workspace",
    });
    const sessionState = createAgentContinuitySemanticStateIdentity("用户已完成运动", {
      kind: "session",
      id: "session-1",
    });

    expect(workspaceState.uri).not.toBe(sessionState.uri);
    expect(
      createAgentContinuitySemanticStateIdentity("用户已完成运动", {
        kind: "workspace",
        id: `  ${workspaceState.scope.id}  `,
      }).uri,
    ).toBe(workspaceState.uri);
  });

  test("resolves fact lifetime and scope from physical continuity-write evidence", () => {
    const turn = recordedTurn();
    turn.sources.unshift(
      continuityWriteSource(turn.episode, "session-memory", "本次会话称呼用户为小雨。", "session"),
      continuityWriteSource(turn.episode, "temporary-memory", "用户本周暂时不喝咖啡。", "2026-08-30T09:00:00+08:00"),
    );
    const observations = new AgentContinuityCandidateCompiler({
      identity: testContinuityIdentity("E:\\workspace"),
      recordedTurn: turn,
      observedAt: "2026-08-23T01:00:02.000Z",
    }).compileFacts(
      parseAgentContinuityFactExtraction({
        items: [
          { kind: "fact", text: "本次会话称呼用户为小雨。" },
          { kind: "fact", text: "用户本周暂时不喝咖啡。" },
          { kind: "fact", text: "用户偏好先给结论。" },
        ],
        agenda: [],
        needsRulePass: false,
      }),
    ).observations;

    expect(observations[0]).toMatchObject({
      payload: { kind: "fact", fact: "本次会话称呼用户为小雨。", until: "session" },
      scope: { kind: "session", id: "session-1" },
      sourceRefs: expect.arrayContaining(["senera://memory-source/session-memory"]),
    });
    expect(observations[1]).toMatchObject({
      payload: {
        kind: "fact",
        fact: "用户本周暂时不喝咖啡。",
        until: "2026-08-30T01:00:00.000Z",
      },
      scope: { kind: "user", id: "E:\\workspace" },
      sourceRefs: expect.arrayContaining(["senera://memory-source/temporary-memory"]),
    });
    expect(observations[2]).toMatchObject({
      payload: { kind: "fact", fact: "用户偏好先给结论。", until: "permanent" },
      scope: { kind: "user", id: "E:\\workspace" },
    });
  });

  test("projects episode sources once and adds condition catalogs only to the rule pass", () => {
    const turn = recordedTurn();
    turn.sources[0] = {
      ...turn.sources[0]!,
      textContent: "Verbose raw tool payload that should not enter the learning prompt.",
      summary: "Verified tool summary.",
    };
    const referents = [
      {
        role: "user" as const,
        text: "上一轮讨论的是过桥米线。",
        createdAt: "2026-08-23T00:59:00.000Z",
      },
    ];
    const factInput = buildAgentContinuityFactPromptInput(
      turn,
      [
        {
          subject: "user",
          key: "居住地点",
          valueJson: JSON.stringify("上海"),
          claim: "居住地点: 上海",
          validUntil: "",
          sourceRefs: ["senera://memory-source/user"],
        },
        {
          subject: "agent",
          key: "回复风格",
          valueJson: JSON.stringify("简洁"),
          claim: "回复风格: 简洁",
          validUntil: "",
          sourceRefs: ["senera://memory-source/agent"],
        },
      ],
      referents,
      {
        world: {
          id: "world-1",
          uri: "senera://world/world-1",
          timeZone: "Asia/Shanghai",
          createdAt: "2026-08-23T00:00:00.000Z",
          updatedAt: "2026-08-23T00:00:00.000Z",
        },
        clock: {
          instant: "2026-08-23T01:00:00.000Z",
          timeZone: "Asia/Shanghai",
          localDate: "2026-08-23",
          localTime: "09:00:00",
          weekdayLabel: "星期日",
        },
        records: [],
        activeGoals: [],
        currentActivities: [],
        timeline: [],
        upcoming: [],
      },
    );
    const ruleInput = buildAgentContinuityRulePromptInput(
      turn,
      ["用户要求运动后提醒查看天气。"],
      {
        stateCatalog: {
          "senera://continuity-state/state_aaaaaaaaaaaaaaaaaaaaaaaa": {
            summary: "用户已完成运动",
            scope: "workspace",
          },
        },
        ruleCatalog: {},
      },
      referents,
    );
    const serialized = JSON.stringify(factInput);

    expect(factInput).toEqual(
      expect.objectContaining({
        timeZone: "Asia/Shanghai",
        completedAt: "2026-08-23T01:00:01.000Z",
        profileCatalog: { 居住地点: "上海" },
        agentProfileCatalog: { 回复风格: "简洁" },
        evidence: expect.any(Array),
        turnContext: expect.any(Array),
        referents,
      }),
    );
    expect(factInput).not.toHaveProperty("stateCatalog");
    expect(ruleInput.facts).toEqual(["用户要求运动后提醒查看天气。"]);
    expect(ruleInput.stateCatalog).toEqual(
      expect.objectContaining({
        "senera://continuity-state/state_aaaaaaaaaaaaaaaaaaaaaaaa": expect.objectContaining({
          summary: "用户已完成运动",
        }),
      }),
    );
    expect(factInput.evidence.find((event) => event.kind === "tool")?.text).toBe("Verified tool summary.");
    expect(factInput.turnContext).toEqual([expect.objectContaining({ kind: "assistant_final", text: "我会记住。" })]);
    expect(serialized).not.toContain("Verbose raw tool payload");
    expect(serialized.match(/运动后提醒我看天气，并且回答简洁；用户偏好先给结论，居住地点是上海。/gu)).toHaveLength(1);
  });
});

function recordedTurn(): AgentMemoryRecordedTurn {
  const episode: AgentMemoryEpisodeRecord = {
    id: "episode-1",
    uri: "senera://memory-episode/episode-1",
    sessionId: "session-1",
    requestId: "request-1",
    status: "completed",
    rawUserText: "运动后提醒我看天气，并且回答简洁；用户偏好先给结论，居住地点是上海。",
    standaloneRequest: "运动后提醒我看天气，并且回答简洁；用户偏好先给结论，居住地点是上海。",
    contextMode: "current",
    contextBasis: "current turn",
    topic: "天气提醒",
    assistantPreview: "用户设置了有条件的天气提醒。",
    startedAt: "2026-08-23T01:00:00.000Z",
    completedAt: "2026-08-23T01:00:01.000Z",
    updatedAt: "2026-08-23T01:00:01.000Z",
    startedAtMs: Date.parse("2026-08-23T01:00:00.000Z"),
    completedAtMs: Date.parse("2026-08-23T01:00:01.000Z"),
    updatedAtMs: Date.parse("2026-08-23T01:00:01.000Z"),
    timeZone: "Asia/Shanghai",
    localDate: "2026-08-23",
    localHour: "09",
    metadata: {},
  };
  return {
    episode,
    sources: [
      source(episode, {
        id: "tool",
        uri: "senera://memory-source/tool",
        sourceKind: "tool_evidence",
        role: "tool",
        textContent: "运动状态和天气提醒已确认。",
        summary: "运动状态和天气提醒已确认。",
        createdAt: "2026-08-23T01:00:00.500Z",
        createdAtMs: Date.parse("2026-08-23T01:00:00.500Z"),
      }),
      source(episode, {
        id: "assistant",
        uri: "senera://memory-source/assistant",
        sourceKind: "assistant_final",
        role: "assistant",
        textContent: "我会记住。",
        summary: "我会记住。",
        createdAt: "2026-08-23T01:00:01.000Z",
        createdAtMs: Date.parse("2026-08-23T01:00:01.000Z"),
      }),
      source(episode, {
        id: "user",
        uri: "senera://memory-source/user",
        sourceKind: "user_message",
        role: "user",
        textContent: "运动后提醒我看天气，并且回答简洁；用户偏好先给结论，居住地点是上海。",
        summary: "运动后提醒我看天气，并且回答简洁；用户偏好先给结论，居住地点是上海。",
        createdAt: "2026-08-23T01:00:00.000Z",
        createdAtMs: Date.parse("2026-08-23T01:00:00.000Z"),
      }),
    ],
  };
}

function source(
  episode: AgentMemoryEpisodeRecord,
  overrides: Partial<AgentMemorySourceRecord>,
): AgentMemorySourceRecord {
  const createdAt = overrides.createdAt ?? episode.startedAt;
  const createdAtMs = overrides.createdAtMs ?? Date.parse(createdAt);
  return {
    id: "source",
    uri: "senera://memory-source/source",
    episodeId: episode.id,
    episodeUri: episode.uri,
    sessionId: episode.sessionId,
    requestId: episode.requestId,
    sourceKind: "user_message",
    role: "user",
    textContent: "evidence",
    summary: "evidence",
    conversationEntryId: "entry-1",
    evidenceUri: "",
    artifactUri: "",
    toolName: "",
    createdAt,
    updatedAt: createdAt,
    createdAtMs,
    updatedAtMs: createdAtMs,
    timeZone: episode.timeZone,
    localDate: episode.localDate,
    localHour: episode.localHour,
    metadata: {},
    ...overrides,
  };
}

function continuityWriteSource(
  episode: AgentMemoryEpisodeRecord,
  id: string,
  summary: string,
  until: string,
): AgentMemorySourceRecord {
  return source(episode, {
    id,
    uri: `senera://memory-source/${id}`,
    sourceKind: "tool_evidence",
    role: "tool",
    summary: `memory intent: ${summary}`,
    toolName: "MemoryWriteTool",
    metadata: {
      evidence: {
        kind: "continuity_write",
        facts: [
          { name: "kind", value: "fact" },
          { name: "summary", value: summary },
          { name: "until", value: until },
        ],
      },
    },
  });
}
