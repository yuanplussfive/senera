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
var TavilySearchToolResultSchema_exports = {};
__export(TavilySearchToolResultSchema_exports, {
  Schema: () => Schema
});
module.exports = __toCommonJS(TavilySearchToolResultSchema_exports);
var import_zod = require("@senera/tool-plugin-sdk");
const ImageSchema = import_zod.z.object({
  url: import_zod.z.string(),
  description: import_zod.z.string().optional()
}).strict();
const SearchResultSchema = import_zod.z.object({
  title: import_zod.z.string(),
  url: import_zod.z.string(),
  content: import_zod.z.string(),
  score: import_zod.z.number().optional(),
  publishedDate: import_zod.z.string().optional(),
  rawContent: import_zod.z.string().optional(),
  favicon: import_zod.z.string().optional(),
  images: import_zod.z.object({
    item: import_zod.z.array(ImageSchema)
  }).strict().optional()
}).strict();
const Schema = import_zod.z.object({
  query: import_zod.z.string(),
  answer: import_zod.z.string().optional(),
  results: import_zod.z.object({
    item: import_zod.z.array(SearchResultSchema)
  }).strict(),
  images: import_zod.z.object({
    item: import_zod.z.array(ImageSchema)
  }).strict(),
  responseTime: import_zod.z.coerce.number().optional(),
  requestId: import_zod.z.string().optional(),
  usage: import_zod.z.object({
    credits: import_zod.z.number().optional()
  }).strict().optional(),
  autoParameters: import_zod.z.object({
    topic: import_zod.z.string().optional(),
    searchDepth: import_zod.z.string().optional()
  }).strict().optional(),
  source: import_zod.z.literal("Tavily")
}).strict();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Schema
});
