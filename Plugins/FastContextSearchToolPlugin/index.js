"use strict";

const pluginSdk = require("@senera/tool-plugin-sdk");
const { rgPath } = require("@vscode/ripgrep");
const core = require("@senera/workspace-context-core");
const { Schema: ArgumentsSchema } = require("./Schemas/FastContextSearchToolArgumentsSchema.js");
const { Schema: ResultSchema } = require("./Schemas/FastContextSearchToolResultSchema.js");
const { Schema: SymbolArgumentsSchema } = require("./Schemas/FastContextSymbolSearchToolArgumentsSchema.js");
const { Schema: SymbolResultSchema } = require("./Schemas/FastContextSymbolSearchToolResultSchema.js");

const deps = {
  rgPath
};

void pluginSdk.runToolPluginSuite([
  {
    toolName: "FastContextHybridSearchTool",
    argumentSchema: ArgumentsSchema,
    resultSchema: ResultSchema,
    async execute(args) {
      const context = core.createContext();
      const config = core.readConfig(context, pluginSdk.parsePluginTomlConfig);
      return core.searchHybrid(context, config, args, deps);
    }
  },
  {
    toolName: "FastContextSymbolSearchTool",
    argumentSchema: SymbolArgumentsSchema,
    resultSchema: SymbolResultSchema,
    async execute(args) {
      const context = core.createContext();
      const config = core.readConfig(context, pluginSdk.parsePluginTomlConfig);
      return core.searchSymbols(context, config, args, deps);
    }
  },
  {
    toolName: "FastContextSearchTool",
    argumentSchema: ArgumentsSchema,
    resultSchema: ResultSchema,
    async execute(args) {
      const context = core.createContext();
      const config = core.readConfig(context, pluginSdk.parsePluginTomlConfig);
      return core.searchWorkspace(context, config, args, rgPath);
    }
  }
]);
