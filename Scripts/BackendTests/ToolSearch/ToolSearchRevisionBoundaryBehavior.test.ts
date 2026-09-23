import { describe, expect, test, vi } from "vitest";
import { AgentToolSearchRuntime } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchRuntime.js";
import { InMemoryToolSearchMemoryStore } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchMemoryStore.js";
import type { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";
import {
  createRegistry,
  createTool,
  createToolLearningConfig,
  createToolSearchConfig,
} from "./ToolSearchTestFixtures.js";

describe("ToolSearch revision boundaries", () => {
  test("keeps lexical discovery usable and reports an enabled semantic engine failure", async () => {
    const config = createToolSearchConfig();
    config.Embedding.Enabled = true;
    const embed = vi.fn().mockRejectedValue(new Error("embedding endpoint unavailable"));
    const runtime = new AgentToolSearchRuntime(
      createRegistry([
        createTool({
          name: "WorkspaceSearch",
          title: "Workspace search",
          summary: "Search workspace records",
          tags: ["workspace", "search"],
          actions: ["search"],
          targets: ["records"],
          priority: 20,
        }),
      ]) as unknown as AgentExtensionRegistry,
      config,
      createToolLearningConfig(),
      "E:/workspace",
      createModelProvider(),
      {
        memoryStore: new InMemoryToolSearchMemoryStore(),
        embedding: { model: "embedding-test", client: { embed } },
        availableExecutionTargets: () => ["Local"],
      },
    );

    const result = await runtime.discover({ query: "我是谁" });
    expect(result).toMatchObject({
      status: "empty",
      reason: "no_match",
      diagnostics: ["semantic_unavailable"],
    });
    expect(embed).toHaveBeenCalledTimes(1);
    await runtime.close();
  });

  test("does not mix a completed search index with a refreshed catalog revision", async () => {
    const config = createToolSearchConfig();
    config.Embedding.Enabled = true;
    let refreshRuntime = (): void => undefined;
    const embed = vi.fn().mockImplementation(async (request: { role: string }) => {
      if (request.role === "query") refreshRuntime();
      return { model: "embedding-test", vectors: [[1, 0]] };
    });
    const runtime = new AgentToolSearchRuntime(
      createRegistry([
        createTool({
          name: "WorkspaceSearch",
          title: "Workspace search",
          summary: "Search workspace records",
          tags: ["workspace", "search"],
          actions: ["search"],
          targets: ["records"],
          priority: 20,
        }),
      ]) as unknown as AgentExtensionRegistry,
      config,
      createToolLearningConfig(),
      "E:/workspace",
      createModelProvider(),
      {
        memoryStore: new InMemoryToolSearchMemoryStore(),
        embedding: { model: "embedding-test", client: { embed } },
        availableExecutionTargets: () => ["Local"],
      },
    );
    refreshRuntime = () => runtime.refresh();

    const discovery = await runtime.discover({ query: "search workspace records" });
    expect(discovery).toMatchObject({
      status: "stale",
      reason: "catalog_changed",
      match: [],
      maybe: [],
      omitted: [],
    });
    expect(embed.mock.calls.filter(([request]) => request.role === "query")).toHaveLength(2);
    await runtime.close();
  });

  test("restarts background prewarm after a catalog refresh during vector preparation", async () => {
    let refreshRuntime = (): void => undefined;
    let documentCalls = 0;
    const tools = [
      createTool({
        name: "WorkspaceSearch",
        title: "Workspace search",
        summary: "Search workspace records",
        tags: ["workspace", "search"],
        actions: ["search"],
        targets: ["records"],
        priority: 20,
      }),
    ];
    const embed = vi.fn().mockImplementation(async (request: { role: string }) => {
      if (request.role === "document") {
        documentCalls += 1;
        if (documentCalls === 1) {
          tools.push(
            createTool({
              name: "WorkspaceList",
              title: "List workspace records",
              summary: "List workspace records",
              tags: ["workspace", "list"],
              actions: ["list"],
              targets: ["records"],
              priority: 10,
            }),
          );
          refreshRuntime();
        }
      }
      return { model: "embedding-test", vectors: [[1, 0]] };
    });
    const runtime = new AgentToolSearchRuntime(
      createRegistry(tools) as unknown as AgentExtensionRegistry,
      createToolSearchConfig(),
      createToolLearningConfig(),
      "E:/workspace",
      createModelProvider(),
      {
        memoryStore: new InMemoryToolSearchMemoryStore(),
        embedding: { model: "embedding-test", client: { embed } },
        availableExecutionTargets: () => ["Local"],
      },
    );
    refreshRuntime = () => runtime.refresh();

    await runtime.prewarm();

    expect(documentCalls).toBe(2);
    await runtime.close();
  });
});
