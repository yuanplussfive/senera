import assert from "node:assert/strict";
import { AgentActionPlannerContextBuilder } from "../Source/AgentSystem/AgentActionPlannerContext.js";
import type { AgentToolCatalogItem } from "../Source/AgentSystem/AgentToolCatalogProjector.js";
import { EmptyActionPlannerLedger } from "../Source/AgentSystem/AgentActionPlannerContext.js";

const tools = Array.from({ length: 64 }, (_value, index) => createTool(index));

const input = new AgentActionPlannerContextBuilder().buildInput({
  requestId: "verify-full-catalog-context",
  userMessage: "需要选择合适工具",
  currentStep: 1,
  dynamicTools: true,
  loadedToolNames: ["Tool63"],
  messages: [{
    role: "user",
    content: "需要选择合适工具",
  }],
  ledger: EmptyActionPlannerLedger,
  toolCatalog: tools,
});

assert.equal(input.toolCatalog.length, tools.length);
assert.equal(input.compactToolCatalog.length, tools.length);
assert.equal(input.toolCatalog.at(-1)?.name, "Tool63");
assert.equal(input.toolCatalog.find((tool) => tool.name === "Tool63")?.loaded, true);
assert.equal(input.compactToolCatalog.find((tool) => tool.name === "Tool63")?.loaded, true);

console.log("Action planner full catalog context verification passed.");

function createTool(index: number): AgentToolCatalogItem {
  return {
    name: `Tool${index}`,
    title: `Tool ${index}`,
    summary: `Fixture tool ${index}.`,
    rootKind: "User",
    capabilities: [],
    tags: [],
    useCases: [],
    examples: [],
    avoid: [],
    permissions: [],
    evidenceCapabilities: [],
  };
}
