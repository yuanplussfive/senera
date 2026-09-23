import { describe, expect, test } from "vitest";
import { AgentToolSearchRuntime } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchRuntime.js";
import {
  AgentLocalEmbeddingClient,
  AgentLocalEmbeddingModelName,
} from "../../../Source/AgentSystem/ToolSearch/AgentLocalEmbeddingClient.js";
import { InMemoryToolSearchMemoryStore } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchMemoryStore.js";
import type { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";
import {
  createRegistry,
  createTool,
  createToolLearningConfig,
  createToolSearchConfig,
} from "./ToolSearchTestFixtures.js";

describe("ToolSearch semantic retrieval with the local embedding client", () => {
  test("recalls an English capability that shares no lexical terms with the query", async () => {
    const config = createToolSearchConfig();
    config.Embedding.Enabled = true;
    const runtime = new AgentToolSearchRuntime(
      createRegistry([
        createTool({
          name: "ArtworkCreator",
          title: "Visual artwork creator",
          summary: "Create visual artwork from a text description",
          tags: ["artwork"],
          actions: ["create"],
          targets: ["picture"],
          priority: 50,
        }),
        createTool({
          name: "WeatherForecast",
          title: "Weather forecast",
          summary: "Report current weather conditions for a city",
          tags: ["weather"],
          actions: ["report"],
          targets: ["city"],
          priority: 50,
        }),
        createTool({
          name: "ShellRunner",
          title: "Shell runner",
          summary: "Execute one shell command and return output",
          tags: ["shell"],
          actions: ["execute"],
          targets: ["process"],
          priority: 50,
        }),
      ]) as unknown as AgentExtensionRegistry,
      config,
      createToolLearningConfig(),
      "E:/workspace",
      createModelProvider(),
      {
        memoryStore: new InMemoryToolSearchMemoryStore(),
        embedding: { client: new AgentLocalEmbeddingClient(), model: AgentLocalEmbeddingModelName },
        availableExecutionTargets: () => ["Local"],
      },
    );

    const discovery = await runtime.discover({ query: "generate an image" });
    const results = [...discovery.match, ...discovery.maybe];

    expect(results).toEqual(expect.arrayContaining([expect.objectContaining({ toolName: "ArtworkCreator" })]));
    expect(results.find((result) => result.toolName === "ArtworkCreator")?.ranks.semantic).toBe(1);
    await runtime.close();
  });

  test("recalls an English capability from a Chinese query with the builtin multilingual encoder", async () => {
    const config = createToolSearchConfig();
    config.Embedding.Enabled = true;
    const runtime = new AgentToolSearchRuntime(
      createRegistry([
        createTool({
          name: "WeatherForecast",
          title: "Weather forecast",
          summary: "Get the current weather, temperature, and wind for a city.",
          tags: ["weather", "forecast"],
          actions: ["inspect"],
          targets: ["city", "weather"],
          priority: 20,
        }),
        createTool({
          name: "FileReader",
          title: "Workspace file reader",
          summary: "Read text content from a project file in the workspace.",
          tags: ["workspace", "file"],
          actions: ["read"],
          targets: ["workspace", "file"],
          priority: 20,
        }),
      ]) as unknown as AgentExtensionRegistry,
      config,
      createToolLearningConfig(),
      "E:/workspace",
      createModelProvider(),
      {
        memoryStore: new InMemoryToolSearchMemoryStore(),
        embedding: { client: new AgentLocalEmbeddingClient(), model: AgentLocalEmbeddingModelName },
        availableExecutionTargets: () => ["Local"],
      },
    );

    const discovery = await runtime.discover({ query: "上海气象情况" });
    const results = [...discovery.match, ...discovery.maybe];

    expect(results).toEqual(expect.arrayContaining([expect.objectContaining({ toolName: "WeatherForecast" })]));
    expect(results.find((result) => result.toolName === "WeatherForecast")?.ranks.semantic).toBe(1);
    await runtime.close();
  });
});
