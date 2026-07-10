import assert from "node:assert/strict";
import path from "node:path";
import { AgentPluginRegistry } from "../Source/AgentSystem/Plugin/AgentPluginRegistry.js";
import type { RootCommandToolSelectorManifest } from "../Source/AgentSystem/Types/PluginManifestTypes.js";
import type { LoadedPlugin } from "../Source/AgentSystem/Types/PluginRuntimeTypes.js";

const registry = new AgentPluginRegistry();
registry.registerPlugin(pluginFixture({
  name: "ValidPluginReferences",
  tools: ["KnownTool", "AskUserTool"],
  recommendedTools: ["KnownTool"],
  rootCommandToolNames: ["AskUserTool"],
}));
assert.doesNotThrow(() => registry.validateAgentReferences());

const missingSkillTool = new AgentPluginRegistry();
missingSkillTool.registerPlugin(pluginFixture({
  name: "MissingSkillToolReference",
  tools: ["KnownTool"],
  recommendedTools: ["MissingTool"],
  rootCommandToolNames: [],
}));
assert.throws(
  () => missingSkillTool.validateAgentReferences(),
  /Skill "ReferenceSkill" in plugin "MissingSkillToolReference".*MissingTool/s,
);

const missingRootCommandTool = new AgentPluginRegistry();
missingRootCommandTool.registerPlugin(pluginFixture({
  name: "MissingRootCommandToolReference",
  tools: ["KnownTool"],
  recommendedTools: ["KnownTool"],
  rootCommandToolNames: ["MissingTool"],
}));
assert.throws(
  () => missingRootCommandTool.validateAgentReferences(),
  /RootCommand "ask_user" in plugin "MissingRootCommandToolReference".*MissingTool/s,
);

const hostCapabilityReference = new AgentPluginRegistry();
hostCapabilityReference.registerPlugin(pluginFixture({
  name: "ValidHostCapabilityReference",
  tools: ["ToolSearchTool"],
  toolCapabilities: {
    ToolSearchTool: "tool.search",
  },
  recommendedTools: [],
  rootCommandToolNames: [],
  rootCommandHostCapability: "tool.search",
}));
assert.doesNotThrow(() => hostCapabilityReference.validateAgentReferences());

const missingHostCapability = new AgentPluginRegistry();
missingHostCapability.registerPlugin(pluginFixture({
  name: "MissingHostCapabilityReference",
  tools: ["KnownTool"],
  recommendedTools: ["KnownTool"],
  rootCommandToolNames: [],
  rootCommandHostCapability: "missing.capability",
}));
assert.throws(
  () => missingHostCapability.validateAgentReferences(),
  /RootCommand "ask_user" in plugin "MissingHostCapabilityReference".*missing\.capability/s,
);

console.log("Plugin reference validation verified.");

function pluginFixture(options: {
  name: string;
  tools: readonly string[];
  toolCapabilities?: Readonly<Record<string, string>>;
  recommendedTools: readonly string[];
  rootCommandToolNames: readonly string[];
  rootCommandHostCapability?: string;
}): LoadedPlugin {
  const rootPath = path.join(process.cwd(), "System", "Plugins", options.name);
  return {
    rootPath,
    rootKind: "System",
    manifestPath: path.join(rootPath, "PluginManifest.json"),
    config: loadedPluginConfig(rootPath),
    manifest: {
      Plugin: {
        Name: options.name,
        Version: "0.1.0",
        Kind: "System",
      },
      Tools: options.tools.map((toolName) => ({
        Name: toolName,
        Handler: {
          Kind: "HostCapability",
          Capability: options.toolCapabilities?.[toolName] ?? `verify.${toolName}`,
        },
        Execution: {
          Boundary: "Local",
          Network: "Deny",
          Workspace: "ReadOnly",
          LocalFallback: "Deny",
        },
      })),
      Skills: [{
        Name: "ReferenceSkill",
        DescriptionFile: "./ReferenceSkill.md",
        RecommendedTools: [...options.recommendedTools],
      }],
      RootCommands: [{
        Action: "ask_user",
        OutputMode: "open",
        ToolAccess: "restricted",
        Objective: "Verify named tool references.",
        InsufficiencyPolicy: "Stop when the named tool is unavailable.",
        AllowedTools: rootCommandAllowedTools(options),
        ForbiddenOutputs: [],
        VisibleOutput: {
          Audience: "runtime",
          Start: "tool_call",
          Format: "tool_call",
          Rules: [],
          Repair: {
            Instruction: "Repair the tool call.",
            Rules: [],
          },
        },
        IncludeToolCatalog: false,
      }],
    },
  };
}

function rootCommandAllowedTools(options: {
  rootCommandToolNames: readonly string[];
  rootCommandHostCapability?: string;
}): RootCommandToolSelectorManifest[] {
  if (options.rootCommandToolNames.length > 0) {
    return [{
      Source: "NamedLoaded",
      Names: [...options.rootCommandToolNames],
    }];
  }

  if (options.rootCommandHostCapability) {
    return [{
      Source: "HostCapability",
      Capability: options.rootCommandHostCapability,
    }];
  }

  return [{ Source: "None" }];
}

function loadedPluginConfig(rootPath: string): LoadedPlugin["config"] {
  return {
    fileName: "PluginConfig.toml",
    path: path.join(rootPath, "PluginConfig.toml"),
    exists: false,
    source: "default",
    templateExists: false,
    needsUserConfig: false,
    toml: "",
    sections: [],
    runtime: {
      enabled: true,
      tools: {},
    },
    diagnostics: [],
  };
}
