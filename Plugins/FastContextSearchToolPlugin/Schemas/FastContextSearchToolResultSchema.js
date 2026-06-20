"use strict";

const pluginSdk = require("@senera/tool-plugin-sdk");

const FocusSpanSchema = pluginSdk.z.object({
  start: pluginSdk.z.number().int(),
  end: pluginSdk.z.number().int(),
  text: pluginSdk.z.string()
}).strict();

const FocusItemSchema = pluginSdk.z.object({
  target: pluginSdk.z.string(),
  query: pluginSdk.z.string(),
  value: pluginSdk.z.string(),
  matchedText: pluginSdk.z.string(),
  indices: pluginSdk.z.object({
    item: pluginSdk.z.array(pluginSdk.z.number().int())
  }).strict(),
  spans: pluginSdk.z.object({
    item: pluginSdk.z.array(FocusSpanSchema)
  }).strict(),
  summary: pluginSdk.z.string()
}).strict();

const SearchResultItemSchema = pluginSdk.z.object({
  path: pluginSdk.z.string(),
  startLine: pluginSdk.z.number().int(),
  endLine: pluginSdk.z.number().int(),
  line: pluginSdk.z.number().int(),
  snippet: pluginSdk.z.string(),
  score: pluginSdk.z.number(),
  source: pluginSdk.z.enum([
    "ripgrep",
    "sqlite_fts",
    "sqlite_trigram",
    "index",
    "scan",
    "path",
    "path_fuzzy",
    "symbol",
    "combined"
  ]),
  matches: pluginSdk.z.object({
    item: pluginSdk.z.array(pluginSdk.z.string())
  }).strict(),
  reason: pluginSdk.z.string(),
  focus: pluginSdk.z.object({
    item: pluginSdk.z.array(FocusItemSchema)
  }).strict().optional(),
  focusSummary: pluginSdk.z.string().optional()
}).strict();

const StatsSchema = pluginSdk.z.object({
  resultCount: pluginSdk.z.number().int(),
  ripgrepMatchCount: pluginSdk.z.number().int(),
  pathFuzzyMatchCount: pluginSdk.z.number().int(),
  pathFuzzyScanned: pluginSdk.z.number().int(),
  pathFuzzyCapped: pluginSdk.z.boolean(),
  indexDocumentCount: pluginSdk.z.number().int(),
  indexedFiles: pluginSdk.z.number().int(),
  indexedSymbols: pluginSdk.z.number().int(),
  engines: pluginSdk.z.object({
    item: pluginSdk.z.array(pluginSdk.z.string())
  }).strict(),
  refreshedIndex: pluginSdk.z.boolean(),
  stateFile: pluginSdk.z.string(),
  elapsedMs: pluginSdk.z.number().int()
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
  stats: StatsSchema
}).strict();

module.exports = {
  Schema
};
