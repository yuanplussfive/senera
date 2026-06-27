import assert from "node:assert/strict";
import path from "node:path";
import { loadVerificationConfig } from "./VerificationConfig.js";
import { AgentPluginRegistry } from "../Source/AgentSystem/AgentPluginRegistry.js";
import { AgentPluginScanner } from "../Source/AgentSystem/AgentPluginScanner.js";
import { AgentPromptContextBuilder } from "../Source/AgentSystem/AgentPromptContextBuilder.js";
import { parseToolCallPlan } from "../Source/AgentSystem/AgentToolCallPlannerSchema.js";

const workspaceRoot = process.cwd();
const config = loadVerificationConfig(workspaceRoot);
const registry = new AgentPluginRegistry();
for (const plugin of new AgentPluginScanner(workspaceRoot, config).scan()) {
  registry.registerPlugin(plugin);
}

const promptContext = new AgentPromptContextBuilder(registry, config).buildBaseContext({
  loadedToolNames: ["TavilySearchTool"],
});
const tavily = promptContext.ToolCards.find((tool) => tool.name === "TavilySearchTool");
assert.ok(tavily?.argumentsContract, "TavilySearchTool contract should be loaded.");

const includeAnswer = (tavily.argumentsContract.jsonSchema.properties as Record<string, unknown>).includeAnswer;
assert.deepEqual(includeAnswer, {
  anyOf: [
    { type: "boolean" },
    { type: "string", const: "basic" },
    { type: "string", const: "advanced" },
  ],
});

const accepted = parseToolCallPlan({
  calls: [{
    name: "TavilySearchTool",
    arguments: {
      query: "latest AI news",
      includeAnswer: true,
    },
  }],
}, {
  allowedTools: ["TavilySearchTool"],
  toolContracts: [tavily],
});
assert.equal(accepted.calls[0]?.arguments.includeAnswer, true);

assert.throws(
  () => parseToolCallPlan({
    calls: [{
      name: "TavilySearchTool",
      arguments: {
        query: "latest AI news",
        includeAnswer: "full",
      },
    }],
  }, {
    allowedTools: ["TavilySearchTool"],
    toolContracts: [tavily],
  }),
  /includeAnswer/,
);

console.log("ToolSignature JSON Schema validation verification passed.");
