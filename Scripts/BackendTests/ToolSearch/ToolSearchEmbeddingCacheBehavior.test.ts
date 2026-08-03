import { describe, expect, test, vi } from "vitest";
import type { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { AgentToolSearchRuntime } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchRuntime.js";
import { InMemoryToolSearchMemoryStore } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchInMemoryStore.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";
import {
  createRegistry,
  createTool,
  createToolLearningConfig,
  createToolSearchConfig,
} from "./ToolSearchTestFixtures.js";

describe("ToolSearch embedding cache behavior", () => {
  test("re-embeds a capability when only its semantic description changes", async () => {
    const config = createToolSearchConfig();
    config.Embedding.Enabled = true;
    const tools = [createMutableTool("Search the original archive description.")];
    const embed = vi.fn(async ({ input }: { input: readonly string[] }) => ({
      model: "embedding-test",
      vectors: input.map(() => [1, 0]),
    }));
    const runtime = new AgentToolSearchRuntime(
      createRegistry(tools) as unknown as AgentExtensionRegistry,
      config,
      createToolLearningConfig(),
      "E:/workspace",
      createModelProvider(),
      { memoryStore: new InMemoryToolSearchMemoryStore(), embedding: { model: "embedding-test", client: { embed } } },
    );

    await runtime.resolveInitialLoadedTools("search archive");
    tools[0] = createMutableTool("Find records using the updated semantic description.");
    await runtime.resolveInitialLoadedTools("find updated records");

    expect(embed).toHaveBeenCalledTimes(4);
    expect(embed.mock.calls[0]?.[0].input[0]).toContain("original archive description");
    expect(embed.mock.calls[2]?.[0].input[0]).toContain("updated semantic description");
    runtime.close();
  });
});

function createMutableTool(summary: string) {
  return createTool({
    name: "MutableSearchTool",
    title: "Mutable search",
    summary,
    tags: ["search"],
    actions: ["search"],
    targets: ["archive"],
    priority: 20,
  });
}
