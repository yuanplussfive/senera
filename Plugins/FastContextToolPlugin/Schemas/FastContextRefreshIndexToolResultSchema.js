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
var FastContextRefreshIndexToolResultSchema_exports = {};
__export(FastContextRefreshIndexToolResultSchema_exports, {
  Schema: () => Schema
});
module.exports = __toCommonJS(FastContextRefreshIndexToolResultSchema_exports);
var pluginSdk = require("senera/plugin-sdk");
const Schema = pluginSdk.z.object({
  workspaceRoot: pluginSdk.z.string(),
  indexedFiles: pluginSdk.z.number().int(),
  indexedDocuments: pluginSdk.z.number().int(),
  skippedFiles: pluginSdk.z.number().int(),
  stateFile: pluginSdk.z.string(),
  warnings: pluginSdk.z.object({
    item: pluginSdk.z.array(pluginSdk.z.string())
  }).strict(),
  availableRoots: pluginSdk.z.object({
    item: pluginSdk.z.array(pluginSdk.z.string())
  }).strict(),
  elapsedMs: pluginSdk.z.number().int()
}).strict();
0 && (module.exports = {
  Schema
});
