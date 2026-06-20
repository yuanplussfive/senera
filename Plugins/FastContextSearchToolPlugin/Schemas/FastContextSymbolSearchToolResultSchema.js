"use strict";

const pluginSdk = require("@senera/tool-plugin-sdk");

const SymbolSchema = pluginSdk.z.object({
  id: pluginSdk.z.string(),
  name: pluginSdk.z.string(),
  kind: pluginSdk.z.enum([
    "function",
    "class",
    "interface",
    "type",
    "enum",
    "const",
    "component"
  ]),
  path: pluginSdk.z.string(),
  line: pluginSdk.z.number().int(),
  startLine: pluginSdk.z.number().int(),
  endLine: pluginSdk.z.number().int(),
  signature: pluginSdk.z.string(),
  exported: pluginSdk.z.boolean(),
  imports: pluginSdk.z.object({
    item: pluginSdk.z.array(pluginSdk.z.string())
  }).strict(),
  score: pluginSdk.z.number()
}).strict();

const Schema = pluginSdk.z.object({
  query: pluginSdk.z.string(),
  workspaceRoot: pluginSdk.z.string(),
  symbols: pluginSdk.z.object({
    item: pluginSdk.z.array(SymbolSchema)
  }).strict(),
  warnings: pluginSdk.z.object({
    item: pluginSdk.z.array(pluginSdk.z.string())
  }).strict(),
  availableRoots: pluginSdk.z.object({
    item: pluginSdk.z.array(pluginSdk.z.string())
  }).strict(),
  stats: pluginSdk.z.object({
    resultCount: pluginSdk.z.number().int(),
    symbolCount: pluginSdk.z.number().int(),
    indexedFiles: pluginSdk.z.number().int(),
    indexDocumentCount: pluginSdk.z.number().int(),
    engines: pluginSdk.z.object({
      item: pluginSdk.z.array(pluginSdk.z.string())
    }).strict(),
    stateFile: pluginSdk.z.string(),
    refreshedIndex: pluginSdk.z.boolean(),
    elapsedMs: pluginSdk.z.number().int()
  }).strict()
}).strict();

module.exports = {
  Schema
};
