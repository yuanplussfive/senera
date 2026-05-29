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
var TaskPrioritizerToolResultSchema_exports = {};
__export(TaskPrioritizerToolResultSchema_exports, {
  Schema: () => Schema
});
module.exports = __toCommonJS(TaskPrioritizerToolResultSchema_exports);
var import_zod = require("@senera/tool-plugin-sdk");
const RankedTaskSchema = import_zod.z.object({
  rank: import_zod.z.number().int(),
  title: import_zod.z.string(),
  priorityBand: import_zod.z.enum(["critical", "high", "medium", "low"]),
  score: import_zod.z.number(),
  blocked: import_zod.z.boolean(),
  owner: import_zod.z.string().optional(),
  labels: import_zod.z.object({
    item: import_zod.z.array(import_zod.z.string())
  }).strict().optional()
}).strict();
const PrioritySummarySchema = import_zod.z.object({
  band: import_zod.z.enum(["critical", "high", "medium", "low"]),
  count: import_zod.z.number().int()
}).strict();
const Schema = import_zod.z.object({
  strategy: import_zod.z.string(),
  focusMode: import_zod.z.string(),
  totalTasks: import_zod.z.number().int(),
  totalEffort: import_zod.z.number().int(),
  blockedTaskCount: import_zod.z.number().int(),
  highPriorityTaskCount: import_zod.z.number().int(),
  rankedTasks: import_zod.z.object({
    item: import_zod.z.array(RankedTaskSchema).min(1)
  }).strict(),
  prioritySummary: import_zod.z.object({
    item: import_zod.z.array(PrioritySummarySchema).length(4)
  }).strict(),
  blockedTasks: import_zod.z.object({
    item: import_zod.z.array(import_zod.z.string())
  }).strict()
}).strict();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Schema
});
