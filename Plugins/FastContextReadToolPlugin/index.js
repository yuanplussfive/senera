"use strict";

const pluginSdk = require("@senera/tool-plugin-sdk");
const core = require("@senera/workspace-context-core");
const { Schema: ArgumentsSchema } = require("./Schemas/FastContextReadToolArgumentsSchema.js");
const { Schema: ResultSchema } = require("./Schemas/FastContextReadToolResultSchema.js");

void pluginSdk.runToolPlugin({
  toolName: "FastContextReadTool",
  argumentSchema: ArgumentsSchema,
  resultSchema: ResultSchema,
  async execute(args) {
    const context = core.createContext();
    const config = core.readConfig(context, pluginSdk.parsePluginTomlConfig);
    return core.readFileSegment(context, config, args);
  }
});
