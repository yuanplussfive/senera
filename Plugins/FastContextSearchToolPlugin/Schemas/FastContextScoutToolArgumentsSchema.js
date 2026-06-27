"use strict";

const pluginSdk = require("@senera/tool-plugin-sdk");

const StringArrayObjectSchema = pluginSdk.z.object({
  item: pluginSdk.z.array(pluginSdk.z.string().trim().min(1)).min(1)
}).strict();

const BooleanLikeSchema = pluginSdk.z.preprocess(coerceBooleanLike, pluginSdk.z.boolean());
const PlanningModeSchema = pluginSdk.z.enum(["deterministic", "llm"]);

const Schema = pluginSdk.z.object({
  question: pluginSdk.z.string().trim().min(1),
  hints: StringArrayObjectSchema.optional(),
  roots: StringArrayObjectSchema.optional(),
  exclude: StringArrayObjectSchema.optional(),
  maxQueries: pluginSdk.z.coerce.number().int().min(1).optional(),
  maxResults: pluginSdk.z.coerce.number().int().min(1).optional(),
  maxFiles: pluginSdk.z.coerce.number().int().min(1).optional(),
  contextLines: pluginSdk.z.coerce.number().int().min(0).optional(),
  readLineWindow: pluginSdk.z.coerce.number().int().min(1).optional(),
  refreshIndex: BooleanLikeSchema.optional(),
  planningMode: PlanningModeSchema.optional()
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
