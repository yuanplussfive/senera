"use strict";

const pluginSdk = require("@senera/tool-plugin-sdk");

const StringArrayObjectSchema = pluginSdk.z.object({
  item: pluginSdk.z.array(pluginSdk.z.string())
}).strict();

const FileResultSchema = pluginSdk.z.object({
  kind: pluginSdk.z.literal("file"),
  path: pluginSdk.z.string(),
  startLine: pluginSdk.z.number().int(),
  endLine: pluginSdk.z.number().int(),
  totalLines: pluginSdk.z.number().int(),
  content: pluginSdk.z.string(),
  truncated: pluginSdk.z.boolean()
}).strict();

const DirectoryResultSchema = pluginSdk.z.object({
  kind: pluginSdk.z.literal("directory"),
  path: pluginSdk.z.string(),
  children: StringArrayObjectSchema,
  childCount: pluginSdk.z.number().int(),
  directoryCount: pluginSdk.z.number().int(),
  fileCount: pluginSdk.z.number().int(),
  truncated: pluginSdk.z.boolean(),
  guidance: StringArrayObjectSchema
}).strict();

const Schema = pluginSdk.z.discriminatedUnion("kind", [
  FileResultSchema,
  DirectoryResultSchema
]);

module.exports = {
  Schema
};
