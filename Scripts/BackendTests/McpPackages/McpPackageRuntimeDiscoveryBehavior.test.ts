import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentSystemRuntime } from "../../../Source/AgentSystem/Runtime/AgentSystemRuntime.js";
import { VerificationScenarioSource } from "../../VerificationScenarioSource.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import {
  AgentPiNativeToolBridge,
  AgentPiNativeToolBridgeName,
} from "../../../Source/AgentSystem/Pi/AgentPiNativeToolBridge.js";
import { isAgentToolAuthorized } from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";

const temporaryRoots: string[] = [];
// These cases intentionally exercise real stdio MCP lifecycles, including
// cache restore and credential transitions. Coverage instrumentation and
// shared-runner contention make the lifecycle materially slower than a unit
// test, so keep the bound local to process-backed discovery cases.
const ProcessBackedDiscoveryTestTimeoutMs = 45_000;

afterEach(() => {
  temporaryRoots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
});

describe("MCP package runtime discovery", () => {
  test(
    "discovers tools from standard MCP tools/list only when the query selects the server",
    { timeout: ProcessBackedDiscoveryTestTimeoutMs },
    async () => {
      const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-mcp-runtime-"));
      temporaryRoots.push(workspaceRoot);
      const runtime = AgentSystemRuntime.fromConfig({
        workspaceRoot,
        configPath: path.join(workspaceRoot, "senera.config.json"),
        config: loadHostExecutionExampleConfig(),
        resourcesPath: path.resolve(),
        toolSearchScenarioSource: new VerificationScenarioSource(),
        mcpInputs: {
          resolve(_serverId, binding) {
            return (binding.source === "secret" || binding.source === "config" || binding.source === "oauth") &&
              binding.inputId.endsWith("API_KEY")
              ? { value: "test-key", source: "vault" }
              : undefined;
          },
        },
      });
      try {
        await runtime.initialize();
        expect(runtime.registry.getTool("mcp__weather__forecast")).toBeUndefined();
        expect(runtime.registry.getTool("mcp__imagen__ImageGenerate")).toBeUndefined();
        expect(runtime.registry.getTool("mcp__zavora-computer-use__screenshot")).toBeUndefined();
        const input = "查询北京今天的天气";
        const root = runtime.services.promptContext.buildRootCommand({
          decision: { action: "use_tools", useTools: { instruction: input, preferredTools: [], needs: [] } },
          loadedToolNames: ["ToolSearch", "ToolDescribe"],
        });
        const restricted = runtime.services.promptContext.buildRootCommand({
          decision: { action: "use_tools", useTools: { instruction: input, preferredTools: [], needs: [] } },
          loadedToolNames: ["ToolSearch"],
          allowedToolNames: ["ToolSearch"],
        });
        expect(restricted.toolAccessGrant.authorizedMcpServices).toBeUndefined();
        await runtime.toolSearch.discover({ query: input, toolAccessGrant: restricted.toolAccessGrant });
        expect(runtime.registry.getTool("mcp__weather__forecast")).toBeUndefined();
        const discovery = await runtime.toolSearch.discover({ query: input, toolAccessGrant: root.toolAccessGrant });
        expect(discovery.match.map((tool) => tool.toolName)).toContain("mcp__weather__forecast");
        expect(root.toolAccessGrant.authorizedToolNames).not.toContain("mcp__weather__forecast");
        const weatherTool = runtime.registry.getTool("mcp__weather__forecast");
        expect(weatherTool?.handler).toMatchObject({
          kind: "McpTool",
          tool: "forecast",
          server: {
            transport: "stdio",
            runtime: "node",
            command: "node",
            env: { QWEATHER_API_KEY: "test-key" },
          },
        });
        expect(weatherTool).not.toHaveProperty("observationProjection");
        expect(isAgentToolAuthorized(root.toolAccessGrant, weatherTool!)).toBe(true);
        expect(
          isAgentToolAuthorized(root.toolAccessGrant, {
            name: "another-tool",
            handler: {
              kind: "McpTool",
              tool: "another",
              readOnly: true,
              server: { id: "weather", revision: "changed-package", transport: "http", url: "https://fixture.invalid" },
            },
          }),
        ).toBe(false);
        const exposure = runtime.services.retrieval.createToolExposure(root.toolAccessGrant);
        const description = await runtime.toolSearch.createDescribeHostHandler()(
          { tools: [weatherTool!.name] },
          {
            tool: runtime.registry.getTool("ToolDescribe")!,
            registry: runtime.registry,
            config: loadHostExecutionExampleConfig(),
            workspaceRoot,
            executionEnv: runtime.executionEnv,
            authorizedToolNames: root.toolAccessGrant.authorizedToolNames,
            toolAccessGrant: root.toolAccessGrant,
            toolExposure: exposure,
          },
        );
        expect(description.response.ok).toBe(true);
        expect(exposure.hasConfirmedContract(weatherTool!.name, weatherTool!.contract?.digest)).toBe(true);
        const bridge = new AgentPiNativeToolBridge(runtime.registry, {} as never, "native");
        expect(
          bridge.projectPreflight(
            {
              toolName: AgentPiNativeToolBridgeName,
              toolCallId: "forecast",
              input: { tool: weatherTool!.name, arguments: { location: "北京" } },
            },
            root.toolAccessGrant,
            undefined,
            exposure,
          ).toolName,
        ).toBe(weatherTool!.name);
        expect(runtime.registry.getTool("mcp__imagen__ImageGenerate")).toBeUndefined();
        expect(runtime.registry.getTool("mcp__zavora-computer-use__screenshot")).toBeUndefined();
        const activeSkills = await runtime.skillActivation.activate({ input });
        const recommendedToolRouting = runtime.skillActivation.recommendedToolRouting(activeSkills);
        const loadedTools = await runtime.toolSearch.resolvePlannedLoadedTools({
          input,
          currentLoadedTools: await runtime.toolSearch.resolveInitialLoadedTools(input),
          preferredTools: recommendedToolRouting.dynamicToolNames,
          discover: false,
        });

        expect(activeSkills.map((skill) => skill.name)).toContain("weather-forecast");
        expect(recommendedToolRouting).toEqual({
          directToolNames: [],
          dynamicToolNames: ["mcp__weather__forecast"],
          nativeToolNames: [],
          requiredToolNames: [],
        });
        expect(loadedTools).not.toContain("mcp__weather__forecast");
      } finally {
        await runtime.close();
      }
    },
  );

  test("keeps the runtime available while credential-bound MCP servers are inactive", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-mcp-runtime-missing-credentials-"));
    temporaryRoots.push(workspaceRoot);
    const runtime = AgentSystemRuntime.fromConfig({
      workspaceRoot,
      configPath: path.join(workspaceRoot, "senera.config.json"),
      config: loadHostExecutionExampleConfig(),
      resourcesPath: path.resolve(),
      toolSearchScenarioSource: new VerificationScenarioSource(),
      mcpInputs: { resolve: () => undefined },
    });

    try {
      await expect(runtime.initialize()).resolves.toBeUndefined();
      expect(runtime.registry.getTool("mcp__weather__forecast")).toBeUndefined();
      const discovery = await runtime.toolSearch.discover({ query: "查询北京今天的天气" });
      expect(discovery.services).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "weather",
            availability: { status: "needs_input", inputIds: ["QWEATHER_API_KEY"] },
          }),
        ]),
      );
      expect(runtime.registry.getTool("mcp__weather__forecast")).toBeUndefined();
      const activeSkills = await runtime.skillActivation.activate({ input: "查询北京今天的天气" });
      expect(activeSkills.find((skill) => skill.name === "weather-forecast")?.recommendedTools).toEqual([]);
    } finally {
      await runtime.close();
    }
  });

  test(
    "restores a discovered schema from cache without starting unrelated servers",
    { timeout: ProcessBackedDiscoveryTestTimeoutMs },
    async () => {
      const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-mcp-schema-cache-"));
      temporaryRoots.push(workspaceRoot);
      let credential: string | undefined = "test-key";
      const createRuntime = () =>
        AgentSystemRuntime.fromConfig({
          workspaceRoot,
          configPath: path.join(workspaceRoot, "senera.config.json"),
          config: loadHostExecutionExampleConfig(),
          resourcesPath: path.resolve(),
          toolSearchScenarioSource: new VerificationScenarioSource(),
          mcpInputs: {
            resolve(_serverId, binding) {
              return (binding.source === "secret" || binding.source === "config" || binding.source === "oauth") &&
                binding.inputId.endsWith("API_KEY")
                ? credential
                  ? { value: credential, source: "vault" }
                  : undefined
                : undefined;
            },
          },
        });

      const firstRuntime = createRuntime();
      try {
        await firstRuntime.initialize();
        await firstRuntime.toolSearch.search({ query: "查询北京今天的天气" });
        expect(firstRuntime.registry.getTool("mcp__weather__forecast")).toBeDefined();
      } finally {
        await firstRuntime.close();
      }

      const secondRuntime = createRuntime();
      try {
        await secondRuntime.initialize();
        expect(secondRuntime.registry.getTool("mcp__weather__forecast")).toBeDefined();
        expect(secondRuntime.registry.getTool("mcp__imagen__ImageGenerate")).toBeUndefined();
        expect(secondRuntime.registry.getTool("mcp__zavora-computer-use__screenshot")).toBeUndefined();
      } finally {
        await secondRuntime.close();
      }

      credential = "replacement-test-key";
      const replacementRuntime = createRuntime();
      try {
        await replacementRuntime.initialize();
        expect(replacementRuntime.registry.getTool("mcp__weather__forecast")?.availability).toEqual({
          status: "unverified",
        });
        const discovery = await replacementRuntime.toolSearch.discover({ query: "查询北京天气" });
        expect(discovery.match.map((tool) => tool.toolName)).toContain("mcp__weather__forecast");
        expect(replacementRuntime.registry.getTool("mcp__weather__forecast")?.availability).toEqual({
          status: "ready",
        });
        expect(replacementRuntime.registry.getTool("mcp__weather__forecast")?.handler).toMatchObject({
          server: { env: { QWEATHER_API_KEY: credential } },
        });
      } finally {
        await replacementRuntime.close();
      }

      credential = undefined;
      const missingRuntime = createRuntime();
      try {
        await missingRuntime.initialize();
        const tool = missingRuntime.registry.getTool("mcp__weather__forecast");
        expect(tool?.contract?.arguments?.jsonSchema).toBeDefined();
        expect(tool?.availability).toEqual({ status: "needs_input", inputIds: ["QWEATHER_API_KEY"] });
        const discovery = await missingRuntime.toolSearch.discover({ query: "查询北京天气" });
        expect(discovery.match.find((result) => result.toolName === tool?.name)?.availability).toEqual(
          tool?.availability,
        );
        expect(await missingRuntime.toolSearch.resolveInitialLoadedTools("查询北京天气", [tool!.name])).not.toContain(
          tool!.name,
        );
      } finally {
        await missingRuntime.close();
      }
    },
  );

  test(
    "keeps healthy MCP servers available when another server cannot start",
    { timeout: ProcessBackedDiscoveryTestTimeoutMs },
    async () => {
      const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-mcp-runtime-partial-"));
      temporaryRoots.push(workspaceRoot);
      const brokenRoot = path.join(workspaceRoot, ".senera", "mcp", "broken");
      fs.mkdirSync(brokenRoot, { recursive: true });
      fs.writeFileSync(
        path.join(brokenRoot, ".mcp.json"),
        JSON.stringify({
          mcpServers: {
            broken: {
              type: "stdio",
              command: process.execPath,
              args: ["--eval", "process.stderr.write('broken MCP fixture\\n'); process.exit(23)"],
              cwd: ".",
            },
          },
        }),
        "utf8",
      );
      const runtime = AgentSystemRuntime.fromConfig({
        workspaceRoot,
        configPath: path.join(workspaceRoot, "senera.config.json"),
        config: loadHostExecutionExampleConfig(),
        resourcesPath: path.resolve(),
        toolSearchScenarioSource: new VerificationScenarioSource(),
        mcpInputs: {
          resolve(_serverId, binding) {
            return binding.source === "secret" ? { value: "test-key", source: "vault" } : undefined;
          },
        },
      });

      try {
        await expect(runtime.initialize()).resolves.toBeUndefined();
        await runtime.toolSearch.search({ query: "查询北京今天的天气" });
        expect(runtime.registry.getTool("mcp__weather__forecast")).toBeDefined();
        expect(runtime.registry.getTool("mcp__broken__broken")).toBeUndefined();
      } finally {
        await runtime.close();
      }
    },
  );

  test(
    "keeps the runtime available when a failed MCP server is referenced by a skill",
    { timeout: ProcessBackedDiscoveryTestTimeoutMs },
    async () => {
      const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-mcp-runtime-failed-skill-"));
      const resourcesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-mcp-resources-failed-skill-"));
      temporaryRoots.push(workspaceRoot, resourcesRoot);
      const skillRoot = path.join(resourcesRoot, "System", "Skills", "broken-weather");
      const packageRoot = path.join(resourcesRoot, "McpServers", "broken");
      fs.mkdirSync(skillRoot, { recursive: true });
      fs.cpSync(path.resolve("System", "Prompts"), path.join(resourcesRoot, "System", "Prompts"), { recursive: true });
      fs.cpSync(path.resolve("System", "Extensions"), path.join(resourcesRoot, "System", "Extensions"), {
        recursive: true,
      });
      fs.mkdirSync(path.join(packageRoot, "mcp"), { recursive: true });
      fs.writeFileSync(
        path.join(skillRoot, "SKILL.md"),
        "---\nname: broken-weather\ndescription: Exercise a temporarily unavailable MCP server.\nmetadata:\n  senera:\n    recommended-tools:\n      - mcp__broken__forecast\n---\nUse the weather tool when it is available.\n",
        "utf8",
      );
      fs.writeFileSync(
        path.join(packageRoot, "manifest.json"),
        JSON.stringify({
          manifest_version: "0.3",
          name: "broken",
          version: "1.0.0",
          server: { type: "node", entry_point: "mcp/server.mjs" },
          _meta: { "ai.senera/execution": { targets: ["local"], preferred: "local" } },
        }),
        "utf8",
      );
      fs.writeFileSync(
        path.join(packageRoot, "mcp", "server.mjs"),
        "process.stderr.write('broken MCP fixture\\n'); process.exit(23);\n",
        "utf8",
      );

      const runtime = AgentSystemRuntime.fromConfig({
        workspaceRoot,
        configPath: path.join(workspaceRoot, "senera.config.json"),
        config: loadHostExecutionExampleConfig(),
        resourcesPath: resourcesRoot,
        toolSearchScenarioSource: new VerificationScenarioSource(),
      });

      try {
        await expect(runtime.initialize()).resolves.toBeUndefined();
        expect(runtime.registry.getTool("mcp__broken__forecast")).toBeUndefined();
        expect(runtime.registry.getSkill("broken-weather")?.recommendedTools).toEqual(["mcp__broken__forecast"]);
      } finally {
        await runtime.close();
      }
    },
  );
});

function loadHostExecutionExampleConfig(): AgentSystemConfig {
  const config = JSON.parse(fs.readFileSync(path.resolve("senera.config.example.json"), "utf8")) as AgentSystemConfig;
  return {
    ...config,
    Defaults: {
      ...config.Defaults,
      SandboxRuntime: {
        ...config.Defaults?.SandboxRuntime,
        Enabled: false,
      },
    },
  };
}
