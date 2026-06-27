"use strict";

const pluginSdk = require("@senera/tool-plugin-sdk");

const StringArraySchema = pluginSdk.z.object({
  item: pluginSdk.z.array(pluginSdk.z.string())
}).strict();

const ScoutFileSchema = pluginSdk.z.object({
  path: pluginSdk.z.string(),
  startLine: pluginSdk.z.number().int(),
  endLine: pluginSdk.z.number().int(),
  totalLines: pluginSdk.z.number().int(),
  score: pluginSdk.z.number(),
  reason: pluginSdk.z.string(),
  focus: pluginSdk.z.string().optional(),
  snippets: StringArraySchema,
  content: pluginSdk.z.string(),
  truncated: pluginSdk.z.boolean()
}).strict();

const ScoutSearchRunSchema = pluginSdk.z.object({
  query: pluginSdk.z.string(),
  resultCount: pluginSdk.z.number().int(),
  engines: StringArraySchema,
  warnings: StringArraySchema
}).strict();

const LlmPlannerDiagnosticsSchema = pluginSdk.z.object({
  status: pluginSdk.z.string(),
  mode: pluginSdk.z.string(),
  rounds: pluginSdk.z.number().int(),
  commands: pluginSdk.z.number().int(),
  finalFiles: pluginSdk.z.number().int(),
  repairs: pluginSdk.z.number().int(),
  errors: StringArraySchema
}).strict();

const Schema = pluginSdk.z.object({
  question: pluginSdk.z.string(),
  workspaceRoot: pluginSdk.z.string(),
  queryPlan: StringArraySchema,
  files: pluginSdk.z.object({
    item: pluginSdk.z.array(ScoutFileSchema)
  }).strict(),
  searchRuns: pluginSdk.z.object({
    item: pluginSdk.z.array(ScoutSearchRunSchema)
  }).strict(),
  warnings: StringArraySchema,
  availableRoots: StringArraySchema,
  diagnostics: pluginSdk.z.object({
    markerCandidates: pluginSdk.z.number().int(),
    referencedCandidates: pluginSdk.z.number().int(),
    searchedQueries: pluginSdk.z.number().int(),
    searchedMatches: pluginSdk.z.number().int(),
    selectedFiles: pluginSdk.z.number().int(),
    refreshedIndex: pluginSdk.z.boolean(),
    elapsedMs: pluginSdk.z.number().int(),
    llmPlanner: LlmPlannerDiagnosticsSchema.optional()
  }).strict()
}).strict();

module.exports = {
  Schema
};
