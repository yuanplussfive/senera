"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const pluginSdk = require("@senera/tool-plugin-sdk");
const { rgPath } = require("@vscode/ripgrep");
const core = require("@senera/workspace-context-core");
const { Schema: ResultSchema } = require("../Plugins/FastContextSearchToolPlugin/Schemas/FastContextScoutToolResultSchema.js");

async function main() {
  const workspaceRoot = process.cwd();
  const context = core.createContext({
    pluginRoot: path.join(workspaceRoot, "Plugins", "FastContextSearchToolPlugin"),
    workspaceRoot
  });
  const config = core.readConfig(context, pluginSdk.parsePluginTomlConfig);
  const result = await core.scoutWorkspace(context, config, {
    question: "我的意思不是插件的配置，是我们的这个项目的主模型配置文件怎么写？",
    planningMode: "deterministic",
    hints: {
      item: [
        "senera.config.example.json",
        "DefaultModelProviderId",
        "ModelProviders",
        "ModelProviderEndpoints"
      ]
    },
    exclude: {
      item: [
        "senera.config.json"
      ]
    },
    maxFiles: 6,
    maxResults: 8,
    readLineWindow: 180
  }, { rgPath });

  ResultSchema.parse(result);
  assertConfigFileEvidence(result);

  const naturalLanguageResult = await core.scoutWorkspace(context, config, {
    question: "我的意思不是插件的配置，是我们的这个项目的主模型配置文件怎么写？",
    planningMode: "deterministic",
    exclude: {
      item: [
        "senera.config.json"
      ]
    },
    maxFiles: 8,
    maxResults: 10,
    readLineWindow: 180
  }, { rgPath });

  ResultSchema.parse(naturalLanguageResult);
  assertConfigFileEvidence(naturalLanguageResult);
  assert.ok(
    naturalLanguageResult.diagnostics.referencedCandidates > 0,
    "Scout should follow referenced workspace files from discovered context."
  );

  const fakePlanner = createFakePlannerClient([
    {
      action: "commands",
      commands: [
        {
          type: "rg",
          pattern: "DefaultModelProviderId",
          path: ".",
          include: ["senera.config.example.json"]
        }
      ],
      reason: "Locate the main model provider setting."
    },
    {
      action: "final",
      files: [
        {
          path: "senera.config.example.json",
          startLine: 1,
          endLine: 80,
          reason: "Contains DefaultModelProviderId and ModelProviders."
        }
      ],
      reason: "Main model config located."
    }
  ]);
  const llmPlannerResult = await core.scoutWorkspace(context, config, {
    question: "主模型配置文件怎么写？",
    maxFiles: 6,
    maxResults: 8,
    readLineWindow: 180
  }, {
    rgPath,
    llmScoutPlanner: fakePlanner
  });

  ResultSchema.parse(llmPlannerResult);
  assertConfigFileEvidence(llmPlannerResult);
  assert.equal(llmPlannerResult.diagnostics.llmPlanner.status, "completed");
  assert.ok(llmPlannerResult.diagnostics.llmPlanner.commands > 0);
  assert.ok(llmPlannerResult.diagnostics.llmPlanner.finalFiles > 0);

  console.log("Fast context scout verification passed.");
}

function assertConfigFileEvidence(result) {
  const files = result.files.item;
  const configFile = files.find((file) => file.path === "senera.config.example.json");
  assert.ok(configFile, "Scout should return senera.config.example.json.");
  assert.match(configFile.content, /DefaultModelProviderId/);
  assert.match(configFile.content, /ModelProviders/);
}

function createFakePlannerClient(decisions) {
  let index = 0;
  return {
    async plan() {
      const decision = decisions[Math.min(index, decisions.length - 1)];
      index += 1;
      return {
        decision,
        repaired: false
      };
    }
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
