import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentSystemRuntime } from "../../../Source/AgentSystem/Runtime/AgentSystemRuntime.js";
import { InMemoryToolSearchMemoryStore } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchMemoryStore.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

const temporaryRoots: string[] = [];
const ProcessBackedDiscoveryTestTimeoutMs = 15_000;

afterEach(() => {
  temporaryRoots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
});

describe("MCP package runtime discovery", () => {
  test(
    "registers tools declared by standard MCP tools/list without auto-exposing them",
    { timeout: ProcessBackedDiscoveryTestTimeoutMs },
    async () => {
      const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-mcp-runtime-"));
      temporaryRoots.push(workspaceRoot);
      const runtime = AgentSystemRuntime.fromConfig({
        workspaceRoot,
        configPath: path.join(workspaceRoot, "senera.config.json"),
        config: loadHostExecutionExampleConfig(),
        resourcesPath: path.resolve(),
        toolSearchMemoryStore: new InMemoryToolSearchMemoryStore(),
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
        expect(weatherTool?.observationProjection).toMatchObject({
          schemaVersion: 2,
          artifactFallback: { strategy: "reference" },
          sources: expect.arrayContaining([expect.objectContaining({ source: "result", mode: "auto" })]),
        });
        expect(runtime.registry.getTool("mcp__zavora_computer_use__doctor")).toBeDefined();
        const input = "查询北京今天的天气";
        const activeSkills = await runtime.skillActivation.activate({ input });
        const recommendedTools = runtime.skillActivation.recommendedToolNames(activeSkills);
        const loadedTools = await runtime.toolSearch.resolvePlannedLoadedTools({
          input,
          currentLoadedTools: await runtime.toolSearch.resolveInitialLoadedTools(input),
          preferredTools: recommendedTools,
          discover: false,
        });

        expect(activeSkills.map((skill) => skill.name)).toContain("weather-forecast");
        expect(recommendedTools).toEqual(["mcp__weather__forecast"]);
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
      toolSearchMemoryStore: new InMemoryToolSearchMemoryStore(),
      mcpInputs: { resolve: () => undefined },
    });

    try {
      await expect(runtime.initialize()).resolves.toBeUndefined();
      expect(runtime.registry.getTool("mcp__weather__forecast")).toBeUndefined();
      const activeSkills = await runtime.skillActivation.activate({ input: "查询北京今天的天气" });
      expect(activeSkills.find((skill) => skill.name === "weather-forecast")?.recommendedTools).toEqual([]);
    } finally {
      await runtime.close();
    }
  });

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
        toolSearchMemoryStore: new InMemoryToolSearchMemoryStore(),
        mcpInputs: {
          resolve(_serverId, binding) {
            return binding.source === "secret" ? { value: "test-key", source: "vault" } : undefined;
          },
        },
      });

      try {
        await expect(runtime.initialize()).resolves.toBeUndefined();
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
        toolSearchMemoryStore: new InMemoryToolSearchMemoryStore(),
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
