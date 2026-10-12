import path from "node:path";
import { describe, expect, test } from "vitest";
import { AgentTurnPromptRenderer } from "../../../Source/AgentSystem/Loop/AgentTurnPromptRenderer.js";
import { AgentPromptRenderer } from "../../../Source/AgentSystem/Prompt/AgentPromptRenderer.js";
import { buildAgentExecutionEnvironmentContext } from "../../../Source/AgentSystem/Prompt/AgentExecutionEnvironmentContext.js";
import { EmptyAgentPersonaContext } from "../../../Source/AgentSystem/Prompt/AgentPersonaContext.js";
import { EmptyAgentContinuityMemoryPromptContext } from "../../../Source/AgentSystem/Continuity/AgentContinuityMemoryTypes.js";
import type { AgentSystemRuntime } from "../../../Source/AgentSystem/Runtime/AgentSystemRuntime.js";
import { toolRootCommand } from "../Support/AgentTestFixtures.js";
import { createSeneraExecutionRuntimeCapabilities } from "../../../Source/AgentSystem/Execution/SeneraExecutionRuntimeCapabilities.js";
import { AgentPromptTierRenderCache } from "../../../Source/AgentSystem/Prompt/AgentPromptTierRenderCache.js";
import { EmptyAgentWorkflowPromptContext } from "../../../Source/AgentSystem/Prompt/AgentWorkflowPromptContext.js";
import { resolveAgentDockerEngineGuestWorkspaceRoot } from "../../../Source/AgentSystem/Sandbox/DockerEngine/AgentDockerEngineRuntimeContract.js";

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
            promptPersona: () => EmptyAgentPersonaContext,
            liveContinuityMemory: async () => EmptyAgentContinuityMemoryPromptContext,
            promptWorkflow: () => EmptyAgentWorkflowPromptContext,
            buildBaseContext: ({ persona }: { persona: unknown }) => ({
              ExecutionEnvironment: buildAgentExecutionEnvironmentContext(process.cwd()),
              ToolCards: [],
              ToolDiscoveryToolName: null,
              RootCommand: rootCommand,
              Persona: persona,
              ContinuityMemory: EmptyAgentContinuityMemoryPromptContext,
              Workflow: EmptyAgentWorkflowPromptContext,
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
          BamlToolAttribution: true,
        },
      } as unknown as AgentSystemRuntime;

      const rendered = await new AgentTurnPromptRenderer(runtime).render({
        userInput: "测试请求",
        loadedToolNames: ["ShellCommandTool"],
        reusableCapabilities: [],
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
      expect(rendered.text).toContain(
        "Use discovery or a tool only when the task needs a capability that is not already available or a verified external outcome; answer directly when neither is needed.",
      );
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

      const identity = await new AgentTurnPromptRenderer(runtime).render({
        userInput: "测试请求",
        sessionId: "conversation-space",
        requestId: "turn-luna",
        logicalCacheScope: "logical-space-cache",
        turnNumber: 3,
        interaction: { surface: "channel", platform: "qq" },
        effectiveModel: {
          sessionId: "conversation-space",
          requestId: "turn-luna",
          providerId: "gpt-5.6-luna",
          model: "gpt-5.6-luna",
          endpoint: "Responses",
          baseUrl: "https://models.example.test/v1",
          source: "request",
          effectiveAt: "2026-09-10T00:00:00.000Z",
          logicalCacheScope: "logical-space-cache",
        },
        loadedToolNames: ["ShellCommandTool"],
        reusableCapabilities: [],
        rootCommand,
        toolPlanningMode: mode,
      });
      const baseline = await new AgentTurnPromptRenderer(runtime).render({
        userInput: "测试请求",
        loadedToolNames: ["ShellCommandTool"],
        reusableCapabilities: [],
        rootCommand,
        toolPlanningMode: mode,
      });
      expect(identity.systemPrompt).toBe(baseline.systemPrompt);
      expect(identity.systemPrompt).not.toContain("senera.conversation_space=v1");
      expect(identity.turnContext).toContain("senera.conversation_space=v1");
      expect(identity.turnContext).toContain("conversation-space");
      expect(identity.turnContext).not.toContain("<senera_conversation_space>");
      expect(identity.turnContext).toContain("senera.turn=v1");
      expect(identity.turnContext).toContain("gpt-5.6-luna");
      expect(identity.turnContext).toContain('"platform":"qq"');
    },
  );

  test("adds Docker shell guidance only when the runtime exposes Sandbox", () => {
    const workspaceRoot = path.resolve(process.cwd());
    const guestWorkspaceRoot = resolveAgentDockerEngineGuestWorkspaceRoot(workspaceRoot, "docker-engine");
    const context = buildAgentExecutionEnvironmentContext(
      workspaceRoot,
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
      workspaceRoot: guestWorkspaceRoot,
      workspacePathStyle: "posix",
      workspaceSeparator: "/",
      workspaceMount: "bind",
    });
    if (guestWorkspaceRoot === workspaceRoot) {
      expect(context.guidance.shell).toContain(
        `Sandbox shell tools run in an isolated Linux container with the posix-sh dialect; its workspace root is ${guestWorkspaceRoot}, identical to the host workspace root.`,
      );
      expect(context.guidance.shell).toContain(
        "Paths inside the sandbox are the same as on the host; prefer workspace-relative paths in tool arguments.",
      );
    } else {
      expect(context.guidance.shell).toContain(
        `Sandbox shell tools run in an isolated Linux container with the posix-sh dialect; its workspace root is ${guestWorkspaceRoot}.`,
      );
      expect(context.guidance.shell).toContain(
        `The host workspace ${workspaceRoot} is bind-mounted at ${guestWorkspaceRoot}; use workspace-relative paths instead of host paths in Sandbox commands.`,
      );
    }
  });

  test.each(["native", "baml"] as const)("renders the volatile prompt without a persona for %s turns", async (mode) => {
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
          promptPersona: () => EmptyAgentPersonaContext,
          liveContinuityMemory: async () => EmptyAgentContinuityMemoryPromptContext,
          promptWorkflow: () => EmptyAgentWorkflowPromptContext,
          buildBaseContext: ({ persona }: { persona: unknown }) => ({
            ExecutionEnvironment: buildAgentExecutionEnvironmentContext(process.cwd()),
            ToolCards: [],
            ToolDiscoveryToolName: null,
            RootCommand: rootCommand,
            Persona: persona,
            ContinuityMemory: EmptyAgentContinuityMemoryPromptContext,
            Workflow: EmptyAgentWorkflowPromptContext,
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
        BamlToolAttribution: true,
      },
    } as unknown as AgentSystemRuntime;

    const rendered = await new AgentTurnPromptRenderer(runtime).render({
      userInput: "测试请求",
      loadedToolNames: ["ShellCommandTool"],
      reusableCapabilities: [],
      rootCommand,
      toolPlanningMode: mode,
    });

    expect(rendered.text).not.toContain("<role_check");
    expect(rendered.text).not.toContain("<persona>");
    expect(rendered.text).not.toContain("<resident_role>");
  });

  test.each(["native", "baml"] as const)(
    "keeps the persona card near output guidance and forwards the current input for %s turns",
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
            promptPersona: () => ({
              enabled: true,
              card: {
                corePersona: "一位可靠的代码审阅搭档。",
                languageStyle: "直接、简洁，并先说明结论。",
              },
            }),
            liveContinuityMemory: async () => EmptyAgentContinuityMemoryPromptContext,
            promptWorkflow: () => EmptyAgentWorkflowPromptContext,
            buildBaseContext: ({ persona }: { persona: unknown }) => ({
              ExecutionEnvironment: buildAgentExecutionEnvironmentContext(process.cwd()),
              ToolCards: [],
              ToolDiscoveryToolName: null,
              RootCommand: rootCommand,
              Persona: persona,
              ContinuityMemory: EmptyAgentContinuityMemoryPromptContext,
              Workflow: EmptyAgentWorkflowPromptContext,
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
          BamlToolAttribution: true,
        },
      } as unknown as AgentSystemRuntime;

      const rendered = await new AgentTurnPromptRenderer(runtime).render({
        userInput: "检查发布流程",
        loadedToolNames: ["ShellCommandTool"],
        reusableCapabilities: [],
        rootCommand,
        toolPlanningMode: mode,
      });

      expect(rendered.text).toContain("<persona>");
      expect(rendered.text).toContain("<resident_role>");
      expect(rendered.text).toContain("一位可靠的代码审阅搭档。");
      expect(rendered.text).toContain("<language_style>");
      expect(rendered.text.indexOf("<language_style>")).toBeGreaterThan(
        rendered.text.indexOf(mode === "native" ? "<native_tool_calling>" : "<planning_guidance>"),
      );
    },
  );

  test.each(["native", "baml"] as const)("keeps learned knowledge in turn context for %s", async (mode) => {
    const rootCommand = toolRootCommand();
    const continuityMemory = {
      enabled: true,
      periodDigests: [],
      eventCandidates: [
        {
          id: "knowledge-1",
          uri: "memos:knowledge-1",
          revision: "rev-1",
          type: "preference",
          summary: "用户偏好简洁回答。",
          occurredAt: "2026-08-22T08:00:00Z",
          score: 0.92,
          matchedBy: ["memos"],
        },
      ],
      selection: {
        digests: { selected: 0, matched: 0, available: 0 },
        events: { selected: 1, matched: 1, available: 1 },
        usedTokens: 32,
        maxTokens: 2048,
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
          promptPersona: () => EmptyAgentPersonaContext,
          liveContinuityMemory: async () => continuityMemory,
          promptWorkflow: () => workflow,
          buildBaseContext: ({
            persona,
            continuityMemory: normalizedContinuityMemory,
            workflow: normalizedWorkflow,
          }: {
            persona: unknown;
            continuityMemory: unknown;
            workflow: unknown;
          }) => ({
            ExecutionEnvironment: buildAgentExecutionEnvironmentContext(process.cwd()),
            ToolCards: [],
            ToolDiscoveryToolName: null,
            RootCommand: rootCommand,
            Persona: persona,
            ContinuityMemory: normalizedContinuityMemory,
            Workflow: normalizedWorkflow,
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
        BamlToolAttribution: true,
      },
    } as unknown as AgentSystemRuntime;

    const rendered = await new AgentTurnPromptRenderer(runtime).render({
      userInput: "继续调查雾港灯塔",
      sessionId: "continuity-session",
      loadedToolNames: [],
      reusableCapabilities: [],
      rootCommand,
      toolPlanningMode: mode,
    });

    expect(rendered.text).toContain("用户偏好简洁回答。");
    expect(rendered.turnContext).toContain("用户偏好简洁回答。");
    expect(rendered.systemPrompt).not.toContain("用户偏好简洁回答。");
    expect(rendered.text).toContain("memos:knowledge-1");
    expect(rendered.text).not.toContain("rev-1");
    expect(rendered.text).not.toContain("senera.profile");
    expect(rendered.text).not.toContain("memory_selection");
  });
});
