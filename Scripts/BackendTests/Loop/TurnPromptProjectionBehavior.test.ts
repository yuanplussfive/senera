import path from "node:path";
import { describe, expect, test } from "vitest";
import { AgentTurnPromptRenderer } from "../../../Source/AgentSystem/Loop/AgentTurnPromptRenderer.js";
import { AgentPromptRenderer } from "../../../Source/AgentSystem/Prompt/AgentPromptRenderer.js";
import { buildAgentExecutionEnvironmentContext } from "../../../Source/AgentSystem/Prompt/AgentExecutionEnvironmentContext.js";
import { EmptyAgentRoleplayPresetContext } from "../../../Source/AgentSystem/Presets/AgentPresetTypes.js";
import type { AgentSystemRuntime } from "../../../Source/AgentSystem/Runtime/AgentSystemRuntime.js";
import { toolRootCommand } from "../Support/AgentTestFixtures.js";
import { createSeneraExecutionRuntimeCapabilities } from "../../../Source/AgentSystem/Execution/SeneraExecutionRuntimeCapabilities.js";

describe("turn prompt projection", () => {
  test.each([
    ["native", "PiNativeSystemPrompt", "<native_tool_calling>", "<planning_guidance>"],
    ["baml", "PiBamlSystemPrompt", "<planning_guidance>", "<native_tool_calling>"],
  ] as const)(
    "renders the %s wire profile without RootCommand or duplicated task text",
    async (mode, name, marker, other) => {
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
            buildBaseContext: () => ({
              ExecutionEnvironment: buildAgentExecutionEnvironmentContext(process.cwd()),
              ToolCards: [],
              ToolDiscoveryToolName: null,
              RootCommand: rootCommand,
              RoleplayPreset: EmptyAgentRoleplayPresetContext,
            }),
          },
        },
        promptRenderer: new AgentPromptRenderer(),
        tokenEstimator: { estimate: (text: string) => ({ tokenCount: text.length }) },
      } as unknown as AgentSystemRuntime;

      const rendered = await new AgentTurnPromptRenderer(runtime).render({
        loadedToolNames: ["ShellCommandTool"],
        rootCommand,
        toolPlanningMode: mode,
      });

      expect(requestedTemplates).toEqual([name]);
      expect(rendered.text).toContain(marker);
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
});
