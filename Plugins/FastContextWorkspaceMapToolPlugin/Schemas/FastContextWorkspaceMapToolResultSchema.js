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
var FastContextWorkspaceMapToolResultSchema_exports = {};
__export(FastContextWorkspaceMapToolResultSchema_exports, {
  Schema: () => Schema
});
module.exports = __toCommonJS(FastContextWorkspaceMapToolResultSchema_exports);
var pluginSdk = require("@senera/tool-plugin-sdk");
const PathGroupSchema = pluginSdk.z.object({
  path: pluginSdk.z.string(),
  kind: pluginSdk.z.enum(["directory", "file"]),
  purpose: pluginSdk.z.string().optional(),
  children: pluginSdk.z.object({
    item: pluginSdk.z.array(pluginSdk.z.string())
  }).strict()
}).strict();
const StringArrayObjectSchema = pluginSdk.z.object({
  item: pluginSdk.z.array(pluginSdk.z.string())
}).strict();
const Schema = pluginSdk.z.object({
  workspaceRoot: pluginSdk.z.string(),
  topLevel: pluginSdk.z.object({
    item: pluginSdk.z.array(PathGroupSchema)
  }).strict(),
  indexedRoots: StringArrayObjectSchema,
  availableRoots: StringArrayObjectSchema,
  project: pluginSdk.z.object({
    markers: StringArrayObjectSchema,
    sourceRoots: StringArrayObjectSchema,
    entryPoints: StringArrayObjectSchema,
    recommendedRoots: StringArrayObjectSchema
  }).strict()
    .optional(),
  guidance: StringArrayObjectSchema
}).strict();
0 && (module.exports = {
  Schema
});
