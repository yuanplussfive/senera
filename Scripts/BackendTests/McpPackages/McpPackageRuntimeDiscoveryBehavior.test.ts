import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentSystemRuntime } from "../../../Source/AgentSystem/Runtime/AgentSystemRuntime.js";
import { InMemoryToolSearchMemoryStore } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchMemoryStore.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  temporaryRoots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
});

describe("MCP package runtime discovery", () => {
  test("registers tools declared by standard MCP tools/list", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-mcp-runtime-"));
    temporaryRoots.push(workspaceRoot);
    const runtime = AgentSystemRuntime.fromConfig({
      workspaceRoot,
      configPath: path.join(workspaceRoot, "senera.config.json"),
      config: loadExampleConfig(),
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
        server: { transport: "stdio", env: { QWEATHER_API_KEY: "test-key" } },
      });
      expect(weatherTool?.observationProjection).toMatchObject({
        schemaVersion: 1,
        artifactFallback: { strategy: "reference" },
        sources: expect.arrayContaining([expect.objectContaining({ source: "result", mode: "auto" })]),
      });
      expect(runtime.registry.getTool("mcp__web_research__search")?.handler).toMatchObject({
        kind: "McpTool",
        tool: "search",
        server: { transport: "stdio", env: { TAVILY_API_KEY: "test-key" } },
      });

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
      expect(loadedTools).toContain("mcp__weather__forecast");
    } finally {
      await runtime.close();
    }
  });

  test("keeps the runtime available while credential-bound MCP servers are inactive", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-mcp-runtime-missing-credentials-"));
    temporaryRoots.push(workspaceRoot);
    const runtime = AgentSystemRuntime.fromConfig({
      workspaceRoot,
      configPath: path.join(workspaceRoot, "senera.config.json"),
      config: loadExampleConfig(),
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
});

function loadExampleConfig(): AgentSystemConfig {
  return JSON.parse(fs.readFileSync(path.resolve("senera.config.example.json"), "utf8")) as AgentSystemConfig;
}
