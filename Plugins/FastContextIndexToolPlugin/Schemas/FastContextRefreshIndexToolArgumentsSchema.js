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
var FastContextRefreshIndexToolArgumentsSchema_exports = {};
__export(FastContextRefreshIndexToolArgumentsSchema_exports, {
  Schema: () => Schema
});
module.exports = __toCommonJS(FastContextRefreshIndexToolArgumentsSchema_exports);
var pluginSdk = require("@senera/tool-plugin-sdk");
const StringArrayObjectSchema = pluginSdk.z.object({
  item: pluginSdk.z.array(pluginSdk.z.string().trim().min(1)).min(1).max(100)
}).strict();
const BooleanLikeSchema = pluginSdk.z.preprocess(coerceBooleanLike, pluginSdk.z.boolean());
const Schema = pluginSdk.z.object({
  roots: StringArrayObjectSchema.optional(),
  force: BooleanLikeSchema.default(true)
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
0 && (module.exports = {
  Schema
});
