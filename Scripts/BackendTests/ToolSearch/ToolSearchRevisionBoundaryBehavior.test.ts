import { describe, expect, test, vi } from "vitest";
import { AgentToolSearchRuntime } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchRuntime.js";
import { VerificationScenarioSource } from "../../VerificationScenarioSource.js";
import type { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";
import { createRegistry, createTool, createToolSearchConfig } from "./ToolSearchTestFixtures.js";
import { AgentCancellationError } from "../../../Source/AgentSystem/Core/AgentCancellation.js";

describe("ToolSearch revision boundaries", () => {
  test("cancels an in-flight prewarm on shutdown and cannot recreate an index after close", async () => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const embed = vi.fn(async (request: { input: readonly string[] }) => {
      entered();
      await paused;
      return { model: "test", vectors: request.input.map(() => [1, 0]) };
    });
    const runtime = revisionRuntime(embed);
    const pending = runtime.prewarm();
    const cancelled = expect(pending).rejects.toBeInstanceOf(AgentCancellationError);
    await started;
    const closing = runtime.close();
    runtime.refresh();
    release();
    await cancelled;
    await closing;
    await expect(runtime.prewarm()).rejects.toBeInstanceOf(AgentCancellationError);
    expect(embed).toHaveBeenCalledOnce();
    await expect(runtime.close()).resolves.toBeUndefined();
  });

  test("continues to surface real endpoint failures during prewarm", async () => {
    const runtime = revisionRuntime(async () => {
      throw new Error("provider is unavailable");
    });
    await expect(runtime.prewarm()).rejects.toThrow("provider is unavailable");
    await runtime.close();
  });
  test("continues with the new catalog after asynchronous old-index cancellation", async () => {
    let reached!: () => void;
    let resume!: () => void;
    const entered = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const release = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let calls = 0;
    const config = createToolSearchConfig();
    config.Embedding.Enabled = true;
    const runtime = new AgentToolSearchRuntime(
      createRegistry([
        createTool({
          name: "WorkspaceSearch",
          title: "Search",
          summary: "Search workspace records",
          tags: ["workspace"],
          actions: ["search"],
          targets: ["records"],
          priority: 20,
        }),
      ]) as unknown as AgentExtensionRegistry,
      config,
      "E:/workspace",
      createModelProvider(),
      {
        scenarioSource: new VerificationScenarioSource(),
        availableExecutionTargets: () => ["Local"],
        embedding: {
          model: "test",
          client: {
            embed: async (request) => {
              if (++calls === 1) {
                reached();
                await release;
              }
              return { model: "test", vectors: request.input.map(() => [1, 0]) };
            },
          },
        },
      },
    );
    const pending = runtime.prewarm();
    await entered;
    // Let the index register its in-flight preparation before replacing it.
    await new Promise<void>((resolve) => setImmediate(resolve));
    runtime.refresh();
    resume();
    await expect(pending).resolves.toBeUndefined();
    expect(calls).toBe(2);
    await runtime.close();
  });
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
      "E:/workspace",
      createModelProvider(),
      {
        scenarioSource: new VerificationScenarioSource(),
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
      "E:/workspace",
      createModelProvider(),
      {
        scenarioSource: new VerificationScenarioSource(),
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
      "E:/workspace",
      createModelProvider(),
      {
        scenarioSource: new VerificationScenarioSource(),
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

function revisionRuntime(
  embed: (request: { input: readonly string[] }) => Promise<{ model: string; vectors: number[][] }>,
) {
  const config = createToolSearchConfig();
  config.Embedding.Enabled = true;
  return new AgentToolSearchRuntime(
    createRegistry([
      createTool({
        name: "WorkspaceSearch",
        title: "Search",
        summary: "Search workspace records",
        tags: ["workspace"],
        actions: ["search"],
        targets: ["records"],
        priority: 20,
      }),
    ]) as unknown as AgentExtensionRegistry,
    config,
    "E:/workspace",
    createModelProvider(),
    {
      scenarioSource: new VerificationScenarioSource(),
      availableExecutionTargets: () => ["Local"],
      embedding: { model: "test", client: { embed } },
    },
  );
}
