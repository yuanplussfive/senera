import path from "node:path";
import { describe, expect, test } from "vitest";
import { AgentTurnPromptRenderer } from "../../../Source/AgentSystem/Loop/AgentTurnPromptRenderer.js";
import { AgentPromptRenderer } from "../../../Source/AgentSystem/Prompt/AgentPromptRenderer.js";
import { buildAgentExecutionEnvironmentContext } from "../../../Source/AgentSystem/Prompt/AgentExecutionEnvironmentContext.js";
import { EmptyAgentRoleplayPresetContext } from "../../../Source/AgentSystem/Presets/AgentPresetTypes.js";
import { EmptyAgentContinuityMemoryPromptContext } from "../../../Source/AgentSystem/Continuity/AgentContinuityMemoryTypes.js";
import type { AgentSystemRuntime } from "../../../Source/AgentSystem/Runtime/AgentSystemRuntime.js";
import { toolRootCommand } from "../Support/AgentTestFixtures.js";
import { createSeneraExecutionRuntimeCapabilities } from "../../../Source/AgentSystem/Execution/SeneraExecutionRuntimeCapabilities.js";
import { AgentPromptTierRenderCache } from "../../../Source/AgentSystem/Prompt/AgentPromptTierRenderCache.js";
import { EmptyAgentWorkflowPromptContext } from "../../../Source/AgentSystem/Prompt/AgentWorkflowPromptContext.js";
import { EmptyAgentSceneContext } from "../../../Source/AgentSystem/Prompt/AgentSceneContextCompiler.js";

describe("turn prompt projection", () => {
  test.each([
    ["native", "PiNativeSystemPrompt", "<native_tool_calling>", "<planning_guidance>"],
    ["baml", "PiBamlSystemPrompt", "<planning_guidance>", "<native_tool_calling>"],
  ] as const)(
    "renders the %s wire profile without RootCommand or duplicated task text",
    async (mode, _name, marker, other) => {
      const requestedTemplates: string[] = [];
      const rootCommand = {
        ...toolRootCommand(["ShellCommandTool"]),
        instruction: "DO NOT DUPLICATE THIS USER TASK",
      };
      const runtime = {
        registry: {
          getTemplate: (templateName: string) => {
            requestedTemplates.push(templateName);
            return {
              name: templateName,
              path: path.resolve(process.cwd(), "System", "Prompts", "Templates", `${templateName}.liquid`),
              exposeToPi: false,
            };
          },
        },
        config: {},
        services: {
          promptContext: {
            promptRoleplayPreset: async () => EmptyAgentRoleplayPresetContext,
            promptContinuityMemory: async () => EmptyAgentContinuityMemoryPromptContext,
            promptWorkflow: () => EmptyAgentWorkflowPromptContext,
            buildBaseContext: ({ roleplayPreset }: { roleplayPreset: unknown }) => ({
              ExecutionEnvironment: buildAgentExecutionEnvironmentContext(process.cwd()),
              ToolCards: [],
              ToolDiscoveryToolName: null,
              RootCommand: rootCommand,
              RoleplayPreset: roleplayPreset,
              ContinuityMemory: EmptyAgentContinuityMemoryPromptContext,
              Workflow: EmptyAgentWorkflowPromptContext,
              Scene: EmptyAgentSceneContext,
              ContextRevisions: { stable: "stable", context: "context", volatile: "volatile" },
            }),
          },
        },
        promptRenderer: new AgentPromptRenderer(),
        promptTierRenderCache: new AgentPromptTierRenderCache(),
        tokenEstimator: { estimate: (text: string) => ({ tokenCount: text.length }) },
        promptConfig: {
          UserMessageEnvelope: true,
          TimeZone: "Asia/Shanghai",
          RoleCheck: true,
          BamlToolAttribution: true,
        },
      } as unknown as AgentSystemRuntime;

      const rendered = await new AgentTurnPromptRenderer(runtime).render({
        userInput: "测试请求",
        loadedToolNames: ["ShellCommandTool"],
        rootCommand,
        toolPlanningMode: mode,
      });

      expect(requestedTemplates).toEqual([
        "SeneraFrozenSystemPrompt",
        mode === "native" ? "PiNativeStableSystemPrompt" : "PiBamlStableSystemPrompt",
        "PiTurnVolatileContext",
      ]);
      expect(rendered.text).toContain(marker);
      expect(rendered.systemPrompt).toContain("<senera_kernel>");
      expect(rendered.text).toContain("<interaction_stance>");
      expect(rendered.text).not.toContain("<world_truth>");
      expect(rendered.text).not.toContain("The hall has never gone fully dark.");
      expect(rendered.text).not.toContain("<resident_role>");
      expect(rendered.text).not.toContain(other);
      expect(rendered.text).not.toContain("DO NOT DUPLICATE THIS USER TASK");
      expect(rendered.text).not.toContain("senera_root_command");
      expect(rendered.text).not.toContain("pi_tool_turn");
      expect(rendered.text).not.toContain("<runtime_tools>");
      expect(rendered.text).not.toContain("<sandbox>");
      expect(rendered.text).not.toContain("Sandbox shell tools");
    },
  );

  test("adds Docker shell guidance only when the runtime exposes Sandbox", () => {
    const context = buildAgentExecutionEnvironmentContext(
      process.cwd(),
      createSeneraExecutionRuntimeCapabilities({
        platform: "linux",
        sandboxProvider: "docker-engine",
        sandboxEnabled: true,
        sandboxReady: true,
      }),
      "linux",
    );

    expect(context.executionTargets.sandbox).toMatchObject({
      boundary: "sandbox",
      os: "Linux",
      shellDialect: "posix-sh",
      workspaceRoot: "/workspace",
      workspacePathStyle: "posix",
      workspaceSeparator: "/",
      workspaceMount: "bind",
    });
    expect(context.guidance.shell).toContain(
      "Sandbox shell tools run in an isolated Linux container with the posix-sh dialect; its workspace root is /workspace.",
    );
    expect(context.guidance.shell).toContain(
      `The host workspace ${path.resolve(process.cwd())} is bind-mounted at /workspace; use workspace-relative paths instead of host paths in Sandbox commands.`,
    );
  });

  test.each(["native", "baml"] as const)(
    "renders the volatile prompt when presets are enabled without an active card for %s turns",
    async (mode) => {
      const rootCommand = toolRootCommand(["ShellCommandTool"]);
      const runtime = {
        registry: {
          getTemplate: (templateName: string) => ({
            name: templateName,
            path: path.resolve(process.cwd(), "System", "Prompts", "Templates", `${templateName}.liquid`),
            exposeToPi: false,
          }),
        },
        config: {},
        services: {
          promptContext: {
            promptRoleplayPreset: async () => ({ enabled: true, activePresetName: null }),
            promptContinuityMemory: async () => EmptyAgentContinuityMemoryPromptContext,
            promptWorkflow: () => EmptyAgentWorkflowPromptContext,
            buildBaseContext: ({ roleplayPreset }: { roleplayPreset: unknown }) => ({
              ExecutionEnvironment: buildAgentExecutionEnvironmentContext(process.cwd()),
              ToolCards: [],
              ToolDiscoveryToolName: null,
              RootCommand: rootCommand,
              RoleplayPreset: roleplayPreset,
              ContinuityMemory: EmptyAgentContinuityMemoryPromptContext,
              Workflow: EmptyAgentWorkflowPromptContext,
              Scene: EmptyAgentSceneContext,
              ContextRevisions: { stable: "stable", context: "context", volatile: "volatile" },
            }),
          },
        },
        promptRenderer: new AgentPromptRenderer(),
        promptTierRenderCache: new AgentPromptTierRenderCache(),
        tokenEstimator: { estimate: (text: string) => ({ tokenCount: text.length }) },
        promptConfig: {
          UserMessageEnvelope: true,
          TimeZone: "Asia/Shanghai",
          RoleCheck: true,
          BamlToolAttribution: true,
        },
      } as unknown as AgentSystemRuntime;

      const rendered = await new AgentTurnPromptRenderer(runtime).render({
        userInput: "测试请求",
        loadedToolNames: ["ShellCommandTool"],
        rootCommand,
        toolPlanningMode: mode,
      });

      expect(rendered.text).not.toContain("<role_check");
      expect(rendered.text).not.toContain("<persona_preset>");
      expect(rendered.text).not.toContain("<resident_role>");
    },
  );

  test.each(["native", "baml"] as const)(
    "keeps the persona card near output guidance and forwards the current input for %s turns",
    async (mode) => {
      let receivedUserInput = "";
      const rootCommand = toolRootCommand(["ShellCommandTool"]);
      const runtime = {
        registry: {
          getTemplate: (templateName: string) => ({
            name: templateName,
            path: path.resolve(process.cwd(), "System", "Prompts", "Templates", `${templateName}.liquid`),
            exposeToPi: false,
          }),
        },
        config: {},
        services: {
          promptContext: {
            promptRoleplayPreset: async (userInput: string) => {
              receivedUserInput = userInput;
              return {
                enabled: true,
                activePresetName: "reviewer.json",
                card: {
                  title: "审阅搭档",
                  corePersona: "一位可靠的代码审阅搭档。",
                  languageStyle: "直接、简洁，并先说明结论。",
                  examples: [{ situation: "工具完成检查", reply: "我找到了两个需要修复的风险。" }],
                  lore: [{ title: "发布流程", content: "当前项目采用发布前双人复核。" }],
                },
              };
            },
            promptContinuityMemory: async () => EmptyAgentContinuityMemoryPromptContext,
            promptWorkflow: () => EmptyAgentWorkflowPromptContext,
            buildBaseContext: ({ roleplayPreset }: { roleplayPreset: unknown }) => ({
              ExecutionEnvironment: buildAgentExecutionEnvironmentContext(process.cwd()),
              ToolCards: [],
              ToolDiscoveryToolName: null,
              RootCommand: rootCommand,
              RoleplayPreset: roleplayPreset,
              ContinuityMemory: EmptyAgentContinuityMemoryPromptContext,
              Workflow: EmptyAgentWorkflowPromptContext,
              Scene: EmptyAgentSceneContext,
              ContextRevisions: { stable: "stable", context: "context", volatile: "volatile" },
            }),
          },
        },
        promptRenderer: new AgentPromptRenderer(),
        promptTierRenderCache: new AgentPromptTierRenderCache(),
        tokenEstimator: { estimate: (text: string) => ({ tokenCount: text.length }) },
        promptConfig: {
          UserMessageEnvelope: true,
          TimeZone: "Asia/Shanghai",
          RoleCheck: true,
          BamlToolAttribution: true,
        },
      } as unknown as AgentSystemRuntime;

      const rendered = await new AgentTurnPromptRenderer(runtime).render({
        userInput: "检查发布流程",
        loadedToolNames: ["ShellCommandTool"],
        rootCommand,
        toolPlanningMode: mode,
      });

      expect(receivedUserInput).toBe("检查发布流程");
      expect(rendered.text).toContain("<persona_preset>");
      expect(rendered.text).toContain("<resident_role>");
      expect(rendered.text).toContain("一位可靠的代码审阅搭档。");
      expect(rendered.text).toContain("当前项目采用发布前双人复核。");
      expect(rendered.text).toContain("<voice_reference>");
      expect(rendered.text.indexOf("<voice_reference>")).toBeGreaterThan(
        rendered.text.indexOf(mode === "native" ? "<native_tool_calling>" : "<planning_guidance>"),
      );
    },
  );

  test.each(["native", "baml"] as const)(
    "projects profile, known facts, and relevant continuity for %s",
    async (mode) => {
      const rootCommand = toolRootCommand();
      const continuityMemory = {
        enabled: true,
        pendingRuleDeliveryUris: ["senera://continuity-rule/internal-delivery"],
        residentProfile: [
          {
            subject: "user" as const,
            key: "居住地点",
            valueJson: JSON.stringify("上海"),
            claim: "居住地点: 上海",
            validUntil: "",
            sourceRefs: ["senera://memory-source/profile-location"],
          },
        ],
        factCatalog: [
          {
            factKey: "fact-hidden-from-prompt",
            claim: "这条完整事实只用于连续性面板诊断。",
            sourceRefs: ["senera://memory-source/fact-hidden-from-prompt"],
            confidence: 1,
            authority: "user_explicit" as const,
            updatedAt: "2026-08-22T08:00:00.000Z",
            score: 0.92,
            matchedBy: ["exact_phrase"],
          },
        ],
        evidenceCandidates: [
          {
            sourceRefs: ["senera://memory-source/harbor"],
            score: 0.44,
            matchedBy: ["lexical"],
          },
        ],
        eventCandidates: [],
        activeRules: [],
        ruleCatalog: [],
        signals: [
          {
            uri: "senera://continuity-state/state_aaaaaaaaaaaaaaaaaaaaaaaa",
            summary: "用户已完成运动",
            valueJson: "true",
            valueType: "boolean" as const,
            observedAt: "2026-08-22T08:00:00.000Z",
            expiresAt: "",
          },
        ],
        selection: {
          profiles: { selected: 1, available: 1 },
          facts: { selected: 1, matched: 1, available: 1 },
          events: { selected: 0, matched: 0 },
          evidence: { selected: 1, matched: 1 },
          usedCharacters: 256,
          maxCharacters: 24_000,
        },
      };
      const workflow = {
        execution: { active: null, executions: [] },
        todos: {
          items: [],
          counts: { total: 0, pending: 0, inProgress: 0, completed: 0, cancelled: 0 },
        },
      };
      const runtime = {
        registry: {
          getTemplate: (templateName: string) => ({
            name: templateName,
            path: path.resolve(process.cwd(), "System", "Prompts", "Templates", `${templateName}.liquid`),
            exposeToPi: false,
          }),
        },
        config: {},
        services: {
          promptContext: {
            promptRoleplayPreset: async () => EmptyAgentRoleplayPresetContext,
            promptContinuityMemory: async () => continuityMemory,
            promptWorkflow: () => workflow,
            buildBaseContext: ({
              roleplayPreset,
              continuityMemory: normalizedContinuityMemory,
              workflow: normalizedWorkflow,
            }: {
              roleplayPreset: unknown;
              continuityMemory: unknown;
              workflow: unknown;
            }) => ({
              ExecutionEnvironment: buildAgentExecutionEnvironmentContext(process.cwd()),
              ToolCards: [],
              ToolDiscoveryToolName: null,
              RootCommand: rootCommand,
              RoleplayPreset: roleplayPreset,
              ContinuityMemory: normalizedContinuityMemory,
              Workflow: normalizedWorkflow,
              Scene: EmptyAgentSceneContext,
              ContextRevisions: { stable: "stable", context: "context", volatile: "volatile" },
            }),
          },
        },
        promptRenderer: new AgentPromptRenderer(),
        promptTierRenderCache: new AgentPromptTierRenderCache(),
        tokenEstimator: { estimate: (text: string) => ({ tokenCount: text.length }) },
        promptConfig: {
          UserMessageEnvelope: true,
          TimeZone: "Asia/Shanghai",
          RoleCheck: true,
          BamlToolAttribution: true,
        },
      } as unknown as AgentSystemRuntime;

      const rendered = await new AgentTurnPromptRenderer(runtime).render({
        userInput: "继续调查雾港灯塔",
        sessionId: "continuity-session",
        loadedToolNames: [],
        rootCommand,
        toolPlanningMode: mode,
      });

      expect(rendered.text).not.toContain("internal-delivery");

      expect(rendered.text).toContain("<continuity_memory");
      expect(rendered.text).toContain("<claim>居住地点: 上海</claim>");
      expect(rendered.systemPrompt).not.toContain("居住地点: 上海");
      expect(rendered.turnContext).toContain("<claim>居住地点: 上海</claim>");
      expect(rendered.text).toContain('<known_facts source="continuity_fact_heads">');
      expect(rendered.text).toContain("这条完整事实只用于连续性面板诊断。");
      expect(rendered.text).not.toContain("<valid_until>");
      expect(rendered.text.indexOf("<known_facts")).toBeLessThan(rendered.text.indexOf("<continuity_memory"));
      expect(rendered.text).toContain("senera://memory-source/harbor");
      expect(rendered.text).toContain("用户已完成运动");
      expect(rendered.text).not.toContain("<workflow_context");
      expect(rendered.text).not.toContain("expires_at=");
      expect(rendered.text).not.toContain("灯塔位于雾港北岸。");
    },
  );
});
