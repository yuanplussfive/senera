"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var FastContextSearchToolResultSchema_exports = {};
__export(FastContextSearchToolResultSchema_exports, {
  Schema: () => Schema
});
module.exports = __toCommonJS(FastContextSearchToolResultSchema_exports);
var pluginSdk = require("senera/plugin-sdk");
const SearchResultItemSchema = pluginSdk.z.object({
  path: pluginSdk.z.string(),
  startLine: pluginSdk.z.number().int(),
  endLine: pluginSdk.z.number().int(),
  line: pluginSdk.z.number().int(),
  snippet: pluginSdk.z.string(),
  score: pluginSdk.z.number(),
  source: pluginSdk.z.enum(["ripgrep", "flexsearch", "combined"]),
  matches: pluginSdk.z.object({
    item: pluginSdk.z.array(pluginSdk.z.string())
  }).strict(),
  reason: pluginSdk.z.string()
}).strict();
const Schema = pluginSdk.z.object({
  query: pluginSdk.z.string(),
  workspaceRoot: pluginSdk.z.string(),
  results: pluginSdk.z.object({
    item: pluginSdk.z.array(SearchResultItemSchema)
  }).strict(),
  warnings: pluginSdk.z.object({
    item: pluginSdk.z.array(pluginSdk.z.string())
  }).strict(),
  availableRoots: pluginSdk.z.object({
    item: pluginSdk.z.array(pluginSdk.z.string())
  }).strict(),
  stats: pluginSdk.z.object({
    resultCount: pluginSdk.z.number().int(),
    ripgrepMatchCount: pluginSdk.z.number().int(),
    queryPatternCount: pluginSdk.z.number().int(),
    indexDocumentCount: pluginSdk.z.number().int(),
    refreshedIndex: pluginSdk.z.boolean(),
    elapsedMs: pluginSdk.z.number().int()
  }).strict()
}).strict();
0 && (module.exports = {
  Schema
});
