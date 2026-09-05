import { describe, expect, test } from "vitest";
import { buildAgentExecutionEnvironmentContext } from "../../../Source/AgentSystem/Prompt/AgentExecutionEnvironmentContext.js";
import { compileAgentPromptContext } from "../../../Source/AgentSystem/Prompt/AgentPromptContextCompiler.js";
import { EmptyAgentContinuityMemoryPromptContext } from "../../../Source/AgentSystem/Continuity/AgentContinuityMemoryTypes.js";
import { EmptyAgentRoleplayPresetContext } from "../../../Source/AgentSystem/Presets/AgentPresetTypes.js";
import { toolRootCommand } from "../Support/AgentTestFixtures.js";
import { EmptyAgentWorkflowPromptContext } from "../../../Source/AgentSystem/Prompt/AgentWorkflowPromptContext.js";
import { EmptyAgentSceneContext } from "../../../Source/AgentSystem/Prompt/AgentSceneContextCompiler.js";

function compile(overrides: Partial<Parameters<typeof compileAgentPromptContext>[0]> = {}) {
  return compileAgentPromptContext({
    executionEnvironment: buildAgentExecutionEnvironmentContext("E:\\senera"),
    toolCards: [],
    toolDiscoveryToolName: null,
    rootCommand: null,
    roleplayPreset: EmptyAgentRoleplayPresetContext,
    continuityMemory: EmptyAgentContinuityMemoryPromptContext,
    workflow: EmptyAgentWorkflowPromptContext,
    scene: EmptyAgentSceneContext,
    ...overrides,
  });
}

describe("agent prompt context compiler", () => {
  test("keeps empty optional layers out of the manifest", () => {
    const context = compile();

    expect(context.ContextLayers).toEqual([
      { name: "kernel", source: "runtime", stability: "stable", included: true },
      { name: "persona", source: "preset", stability: "stable", included: false },
      { name: "profile", source: "profile", stability: "turn", included: false },
      { name: "lore", source: "preset", stability: "turn", included: false },
      { name: "facts", source: "continuity", stability: "turn", included: false },
      { name: "graph", source: "continuity", stability: "turn", included: false },
      { name: "world", source: "runtime", stability: "event", included: false },
      { name: "scene", source: "runtime", stability: "event", included: false },
      { name: "memory", source: "continuity", stability: "turn", included: false },
      { name: "workflow", source: "runtime", stability: "turn", included: false },
      { name: "task", source: "request", stability: "turn", included: false },
    ]);
    expect(context.ContextRevisions.stable).toMatch(/^[a-f0-9]{64}$/);
    expect(context.ContextRevisions.context).toMatch(/^[a-f0-9]{64}$/);
    expect(context.ContextRevisions.volatile).toMatch(/^[a-f0-9]{64}$/);
  });

  test("changes only the volatile revision when the request continuity changes", () => {
    const first = compile({ rootCommand: null });
    const second = compile({ rootCommand: toolRootCommand() });

    expect(second.ContextRevisions.stable).toBe(first.ContextRevisions.stable);
    expect(second.ContextRevisions.context).toBe(first.ContextRevisions.context);
    expect(second.ContextRevisions.volatile).not.toBe(first.ContextRevisions.volatile);
  });

  test("changes only the volatile revision when recalled facts change", () => {
    const first = compile();
    const second = compile({
      continuityMemory: {
        ...EmptyAgentContinuityMemoryPromptContext,
        factCatalog: [
          {
            factKey: "user.location",
            claim: "用户住在上海。",
            sourceRefs: ["senera://memory-source/location"],
            confidence: 1,
            authority: "user_explicit",
            validFrom: "2026-08-01T00:00:00.000Z",
            supportCount: 1,
            supportMass: 1,
            maturity: "active",
            updatedAt: "2026-08-23T00:00:00.000Z",
            score: 0.9,
            matchedBy: ["lexical"],
          },
        ],
      },
    });

    expect(second.ContextRevisions.stable).toBe(first.ContextRevisions.stable);
    expect(second.ContextRevisions.volatile).not.toBe(first.ContextRevisions.volatile);
  });

  test("keeps persona identity stable when only retrieved lore changes", () => {
    const roleplayPreset = {
      enabled: true,
      activePresetName: "resident.json",
      card: {
        title: "Senera",
        corePersona: "可靠的常住代理",
        languageStyle: "简洁",
        examples: [{ situation: "问候", reply: "早上好。" }],
        lore: [{ title: "天气", content: "今天下雨。" }],
      },
    };
    const first = compile({ roleplayPreset });
    const second = compile({
      roleplayPreset: {
        ...roleplayPreset,
        card: {
          ...roleplayPreset.card,
          lore: [{ title: "天气", content: "今天晴朗。" }],
        },
      },
    });

    expect(second.ContextRevisions.stable).toBe(first.ContextRevisions.stable);
    expect(second.ContextRevisions.volatile).not.toBe(first.ContextRevisions.volatile);
    expect(second.ContextLayers.find((layer) => layer.name === "lore")).toMatchObject({ included: true });
  });

  test("marks stable facts and volatile task layers independently", () => {
    const context = compile({
      toolCards: [
        {
          name: "ReadFile",
          description: "读取文件",
          whenToUse: "需要查看文件时",
          whenNotToUse: "不需要文件内容时",
          documentationMarkdown: "",
        },
      ],
      rootCommand: toolRootCommand(),
      roleplayPreset: {
        enabled: true,
        activePresetName: "resident.json",
        card: {
          title: "Senera",
          corePersona: "可靠的常住代理",
          languageStyle: "简洁",
          examples: [],
          lore: [],
        },
      },
      continuityMemory: {
        ...EmptyAgentContinuityMemoryPromptContext,
        enabled: true,
        factCatalog: [
          {
            factKey: "user.response_style",
            claim: "用户偏好简洁回答。",
            sourceRefs: [],
            confidence: 1,
            authority: "user_explicit",
            validFrom: "2026-08-01T00:00:00.000Z",
            supportCount: 1,
            supportMass: 1,
            maturity: "active",
            updatedAt: "2026-08-23T00:00:00.000Z",
            score: 0.9,
            matchedBy: ["lexical"],
          },
        ],
        signals: [
          {
            uri: "senera://continuity-state/state",
            summary: "用户已完成运动",
            valueJson: "true",
            valueType: "boolean",
            observedAt: "2026-08-23T00:00:00.000Z",
            expiresAt: "",
          },
        ],
      },
    });

    expect(context.ContextLayers.filter((layer) => layer.included).map((layer) => layer.name)).toEqual([
      "kernel",
      "persona",
      "facts",
      "task",
    ]);
  });

  test("marks the memory layer when only historical event handles are selected", () => {
    const context = compile({
      continuityMemory: {
        ...EmptyAgentContinuityMemoryPromptContext,
        eventCandidates: [
          {
            sourceRefs: ["senera://memory-source/event"],
            summary: "用户参加了羽毛球活动。",
            occurredAt: "2026-08-23T00:00:00.000Z",
            score: 0.6,
            matchedBy: ["lexical"],
          },
        ],
      },
    });

    expect(context.ContextLayers.find((layer) => layer.name === "memory")).toMatchObject({ included: true });
  });

  test("marks the turn facts layer when relevant persistent facts are selected", () => {
    const context = compile({
      continuityMemory: {
        ...EmptyAgentContinuityMemoryPromptContext,
        factCatalog: [
          {
            factKey: "user.location",
            claim: "用户住在上海。",
            sourceRefs: [],
            confidence: 1,
            authority: "user_explicit",
            validFrom: "2026-08-01T00:00:00.000Z",
            supportCount: 1,
            supportMass: 1,
            maturity: "active",
            updatedAt: "2026-08-23T00:00:00.000Z",
            score: 0.9,
            matchedBy: ["lexical"],
          },
        ],
      },
    });

    expect(context.ContextLayers.find((layer) => layer.name === "facts")).toMatchObject({ included: true });
  });
});
