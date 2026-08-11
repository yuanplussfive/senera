import { expect, test } from "vitest";
import type { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { InMemoryToolSearchMemoryStore } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchMemoryStore.js";
import {
  AgentToolSearchRuntime,
  ToolSearchToolName,
} from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchRuntime.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";
import {
  createRegistry,
  createTool,
  createToolLearningConfig,
  createToolSearchConfig,
} from "./ToolSearchTestFixtures.js";

test("ToolSearch rebuilds discovery from the execution targets currently available on the host", async () => {
  let availableExecutionTargets: Array<"Local" | "Sandbox"> = ["Local"];
  const runtime = new AgentToolSearchRuntime(
    createRegistry([
      createTool({
        name: ToolSearchToolName,
        title: "Tool search",
        summary: "Find tools",
        tags: ["search"],
        actions: ["search"],
        targets: ["tools"],
        priority: 100,
        rootKind: "System",
        loading: "Bootstrap",
      }),
      createTool({
        name: "IsolatedAuditTool",
        title: "Isolated audit",
        summary: "Run an isolated sandbox audit",
        tags: ["isolated", "sandbox", "audit"],
        actions: ["audit"],
        targets: ["workspace"],
        priority: 10,
        rootKind: "User",
        executionTargets: ["Sandbox"],
      }),
    ]) as unknown as AgentExtensionRegistry,
    createToolSearchConfig(),
    createToolLearningConfig(),
    "E:/workspace",
    createModelProvider(),
    {
      memoryStore: new InMemoryToolSearchMemoryStore(),
      availableExecutionTargets: () => availableExecutionTargets,
    },
  );

  try {
    expect((await runtime.search({ query: "isolated sandbox audit" })).map((result) => result.toolName)).not.toContain(
      "IsolatedAuditTool",
    );
    availableExecutionTargets = ["Local", "Sandbox"];
    expect((await runtime.search({ query: "isolated sandbox audit" })).map((result) => result.toolName)).toContain(
      "IsolatedAuditTool",
    );
  } finally {
    runtime.close();
  }
});
