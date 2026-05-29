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
var FastContextWorkspaceMapToolArgumentsSchema_exports = {};
__export(FastContextWorkspaceMapToolArgumentsSchema_exports, {
  Schema: () => Schema
});
module.exports = __toCommonJS(FastContextWorkspaceMapToolArgumentsSchema_exports);
var pluginSdk = require("senera/plugin-sdk");
const Schema = pluginSdk.z.object({
  maxChildrenPerRoot: pluginSdk.z.coerce.number().int().min(0).max(80).default(24)
}).strict();
0 && (module.exports = {
  Schema
});
