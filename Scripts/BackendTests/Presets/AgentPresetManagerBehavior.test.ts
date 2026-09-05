import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentPresetManager } from "../../../Source/AgentSystem/Presets/AgentPresetManager.js";
import {
  AgentPersonaPresetSchemaVersion,
  EmptyAgentRoleplayPresetContext,
  type AgentPersonaPreset,
} from "../../../Source/AgentSystem/Presets/AgentPresetTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import { AgentPresetPromptBudgetDefaults } from "../../../Source/AgentSystem/Presets/AgentPresetPromptBudget.js";
import type { AgentPresetActivationRuntime } from "../../../Source/AgentSystem/Presets/AgentPresetActivationRuntime.js";

const workspaces = new Set<string>();

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("persona preset manager", () => {
  test("projects permanent persona data and only injects keyword-matched lore", async () => {
    const manager = createManager();
    await manager.save({
      name: "reviewer",
      activate: true,
      card: createPersonaCard({
        lore: [
          {
            id: "release",
            title: "发布流程",
            keywords: ["发布", "release"],
            content: "上线前必须完成双人复核。",
            enabled: true,
          },
          {
            id: "disabled",
            title: "停用设定",
            keywords: ["忽略"],
            content: "这条设定不应注入。",
            enabled: false,
          },
        ],
      }),
    });

    await expect(manager.promptContext("请检查 RELEASE 准备情况")).resolves.toMatchObject({
      enabled: true,
      activePresetName: "reviewer.json",
      card: {
        title: "审阅搭档",
        corePersona: "可靠、直接的代码审阅搭档。",
        languageStyle: "先给结论，再给必要细节。",
        examples: [{ situation: "工具完成检查", reply: "我找到了两个需要修复的风险。" }],
        lore: [{ title: "发布流程", content: "上线前必须完成双人复核。" }],
      },
    });

    await expect(manager.promptContext("请检查这段实现")).resolves.toMatchObject({
      enabled: true,
      activePresetName: "reviewer.json",
      card: expect.objectContaining({ lore: [] }),
    });
  });

  test("retrieves a relevant lore entry when the user spells an indexed keyword imperfectly", async () => {
    const manager = createManager();
    await manager.save({
      name: "reviewer",
      activate: true,
      card: createPersonaCard({
        lore: [
          {
            id: "release",
            title: "发布流程",
            keywords: ["release"],
            content: "上线前必须完成双人复核。",
            enabled: true,
          },
        ],
      }),
    });

    await expect(manager.promptContext("请检查 relese 准备情况")).resolves.toMatchObject({
      card: {
        lore: [{ title: "发布流程", content: "上线前必须完成双人复核。" }],
      },
    });
  });

  test("applies configured example, lore, and supplemental character budgets", async () => {
    const { workspaceRoot } = createManagerWithWorkspace();
    const manager = new AgentPresetManager({
      workspaceRoot,
      config: {
        Enabled: true,
        RootDir: ".senera/presets",
        StateFile: ".senera/presets-state.json",
        PromptBudget: {
          MaxExamples: 1,
          MaxLoreEntries: 1,
          MaxSupplementalCharacters: 32,
        },
      },
    });
    await manager.save({
      name: "bounded",
      activate: true,
      card: createPersonaCard({
        examples: [
          { id: "first", situation: "检查", reply: "先给结论。" },
          { id: "second", situation: "复查", reply: "说明证据。" },
        ],
        lore: [
          { id: "release", title: "发布", keywords: ["发布"], content: "需要复核。", enabled: true },
          { id: "branch", title: "分支", keywords: ["发布"], content: "需要签名。", enabled: true },
        ],
      }),
    });

    await expect(manager.promptContext("检查发布")).resolves.toMatchObject({
      card: {
        examples: [{ situation: "检查", reply: "先给结论。" }],
        lore: [{ title: "发布", content: "需要复核。" }],
      },
    });
  });

  test("diagnoses invalid raw documents and rejects an invalid active card", async () => {
    const { manager, workspaceRoot } = createManagerWithWorkspace();
    const presetsRoot = path.join(workspaceRoot, ".senera", "presets");
    fs.mkdirSync(presetsRoot, { recursive: true });
    fs.writeFileSync(
      path.join(presetsRoot, "invalid.json"),
      JSON.stringify({ format: "markdown", content: "旧提示词" }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(workspaceRoot, ".senera", "presets-state.json"),
      JSON.stringify({ activePresetName: "invalid.json" }),
      "utf8",
    );

    const snapshot = await manager.snapshot();
    expect(snapshot.activePresetName).toBeNull();
    expect(snapshot.presets).toHaveLength(1);
    expect(snapshot.presets[0]).toMatchObject({
      name: "invalid.json",
      diagnostics: [expect.objectContaining({ severity: "error" })],
    });
    expect("card" in snapshot.presets[0]).toBe(false);
    await expect(manager.promptContext("旧提示词不应执行")).rejects.toThrow("预设人格卡无效");
  });

  test("returns the empty context when presets are disabled", async () => {
    const { workspaceRoot } = createManagerWithWorkspace();
    const manager = new AgentPresetManager({
      workspaceRoot,
      config: {
        Enabled: false,
        RootDir: ".senera/presets",
        StateFile: ".senera/presets-state.json",
        PromptBudget: AgentPresetPromptBudgetDefaults,
      },
    });

    await expect(manager.promptContext("检查发布")).resolves.toEqual(EmptyAgentRoleplayPresetContext);
  });

  test("migrates v1 cards and synchronizes their explicitly selected resident world", async () => {
    const synchronized: Array<readonly string[] | null> = [];
    const activation: AgentPresetActivationRuntime = {
      catalog: async () => [
        {
          id: "night-life",
          title: "夜间生活",
          entityCount: 3,
          relationCount: 0,
          stateMachineCount: 1,
          habitCount: 1,
          autonomyCount: 0,
        },
      ],
      synchronize: async (preset) => {
        synchronized.push(preset ? [...preset.worldPackageIds] : null);
      },
    };
    const { manager, workspaceRoot } = createManagerWithWorkspace(activation);
    const presetsRoot = path.join(workspaceRoot, ".senera", "presets");
    fs.mkdirSync(presetsRoot, { recursive: true });
    fs.writeFileSync(
      path.join(presetsRoot, "legacy.json"),
      JSON.stringify({
        schemaVersion: "senera.persona/v1",
        title: "旧角色",
        corePersona: "旧人设",
        languageStyle: "简短",
        examples: [],
        lore: [],
      }),
      "utf8",
    );

    await expect(manager.snapshot()).resolves.toMatchObject({
      worldPackages: [{ id: "night-life" }],
      presets: [{ card: { schemaVersion: "senera.persona/v2", worldPackageIds: [] } }],
    });

    await manager.save({
      name: "resident",
      activate: true,
      card: createPersonaCard({ worldPackageIds: ["night-life"] }),
    });
    await manager.setActive({ name: null });
    expect(synchronized).toEqual([["night-life"], null]);
  });
});

function createManager(): AgentPresetManager {
  return createManagerWithWorkspace().manager;
}

function createManagerWithWorkspace(activation?: AgentPresetActivationRuntime): {
  manager: AgentPresetManager;
  workspaceRoot: string;
} {
  const workspaceRoot = createTemporaryDirectory("senera-persona-presets");
  workspaces.add(workspaceRoot);
  return {
    workspaceRoot,
    manager: new AgentPresetManager({
      workspaceRoot,
      config: {
        Enabled: true,
        RootDir: ".senera/presets",
        StateFile: ".senera/presets-state.json",
        PromptBudget: AgentPresetPromptBudgetDefaults,
      },
      activation,
    }),
  };
}

function createPersonaCard(overrides: Partial<AgentPersonaPreset> = {}): AgentPersonaPreset {
  return {
    schemaVersion: AgentPersonaPresetSchemaVersion,
    title: "审阅搭档",
    corePersona: "可靠、直接的代码审阅搭档。",
    languageStyle: "先给结论，再给必要细节。",
    examples: [{ id: "review", situation: "工具完成检查", reply: "我找到了两个需要修复的风险。" }],
    lore: [],
    ...overrides,
    worldPackageIds: [...(overrides.worldPackageIds ?? [])],
  };
}
