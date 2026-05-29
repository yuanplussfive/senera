"use strict";

const pluginSdk = require("@senera/tool-plugin-sdk");

const StringArrayObjectSchema = pluginSdk.z.object({
  item: pluginSdk.z.array(pluginSdk.z.string().trim().min(1)).min(1).max(100)
}).strict();

const SymbolKindArraySchema = pluginSdk.z.object({
  item: pluginSdk.z.array(pluginSdk.z.enum([
    "function",
    "class",
    "interface",
    "type",
    "enum",
    "const",
    "component"
  ])).min(1).max(20)
}).strict();

const BooleanLikeSchema = pluginSdk.z.preprocess(coerceBooleanLike, pluginSdk.z.boolean());

const Schema = pluginSdk.z.object({
  query: pluginSdk.z.string().trim().min(1),
  roots: StringArrayObjectSchema.optional(),
  exclude: StringArrayObjectSchema.optional(),
  kind: SymbolKindArraySchema.optional(),
  maxResults: pluginSdk.z.coerce.number().int().min(1).max(50).optional(),
  refreshIndex: BooleanLikeSchema.default(false)
}).strict();

function coerceBooleanLike(value) {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return value;
}

module.exports = {
  Schema
};
