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
var FastContextReadToolArgumentsSchema_exports = {};
__export(FastContextReadToolArgumentsSchema_exports, {
  Schema: () => Schema
});
module.exports = __toCommonJS(FastContextReadToolArgumentsSchema_exports);
var pluginSdk = require("senera/plugin-sdk");
const Schema = pluginSdk.z.object({
  path: pluginSdk.z.string().trim().min(1),
  startLine: pluginSdk.z.coerce.number().int().min(1).optional(),
  endLine: pluginSdk.z.coerce.number().int().min(1).optional(),
  maxChars: pluginSdk.z.coerce.number().int().min(500).max(5e4).default(12e3)
}).strict().refine(
  (value) => value.endLine === void 0 || value.startLine === void 0 || value.endLine >= value.startLine,
  {
    message: "endLine 必须大于或等于 startLine。",
    path: ["endLine"]
  }
);
0 && (module.exports = {
  Schema
});
