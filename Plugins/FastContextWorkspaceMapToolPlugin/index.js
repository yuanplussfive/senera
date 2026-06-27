"use strict";

const pluginSdk = require("@senera/tool-plugin-sdk");
const core = require("@senera/workspace-context-core");
const { Schema: ArgumentsSchema } = require("./Schemas/FastContextWorkspaceMapToolArgumentsSchema.js");
const { Schema: ResultSchema } = require("./Schemas/FastContextWorkspaceMapToolResultSchema.js");

void pluginSdk.runToolPlugin({
  toolName: "FastContextWorkspaceMapTool",
  argumentSchema: ArgumentsSchema,
  resultSchema: ResultSchema,
  async execute(args, runtimeContext) {
    const context = core.createContext(runtimeContext);
    const config = core.readConfig(context, pluginSdk.parsePluginTomlConfig);
    return core.getWorkspaceMap(context, config, args);
  }
});
