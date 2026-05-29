"use strict";

const pluginSdk = require("@senera/tool-plugin-sdk");
const core = require("@senera/workspace-context-core");
const { Schema: SearchArgumentsSchema } = require("./Schemas/FastContextSearchToolArgumentsSchema.js");
const { Schema: SearchResultSchema } = require("./Schemas/FastContextSearchToolResultSchema.js");
const { Schema: RefreshArgumentsSchema } = require("./Schemas/FastContextRefreshIndexToolArgumentsSchema.js");
const { Schema: RefreshResultSchema } = require("./Schemas/FastContextRefreshIndexToolResultSchema.js");

const deps = {};

void pluginSdk.runToolPluginSuite([
  {
    toolName: "FastContextIndexSearchTool",
    argumentSchema: SearchArgumentsSchema,
    resultSchema: SearchResultSchema,
    async execute(args) {
      const context = core.createContext();
      const config = core.readConfig(context, pluginSdk.parsePluginTomlConfig);
      return core.searchIndex(context, config, args, {
        ...deps,
        tsMorph: null
      });
    }
  },
  {
    toolName: "FastContextRefreshIndexTool",
    argumentSchema: RefreshArgumentsSchema,
    resultSchema: RefreshResultSchema,
    async execute(args) {
      const context = core.createContext();
      const config = core.readConfig(context, pluginSdk.parsePluginTomlConfig);
      return core.refreshIndex(context, config, args, {
        ...deps,
        tsMorph: null
      });
    }
  }
]);
