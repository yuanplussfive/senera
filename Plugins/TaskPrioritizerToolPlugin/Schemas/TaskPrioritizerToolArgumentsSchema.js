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
var TaskPrioritizerToolArgumentsSchema_exports = {};
__export(TaskPrioritizerToolArgumentsSchema_exports, {
  Schema: () => Schema
});
module.exports = __toCommonJS(TaskPrioritizerToolArgumentsSchema_exports);
var import_zod = require("@senera/tool-plugin-sdk");
const BooleanLikeSchema = import_zod.z.preprocess(coerceBooleanLike, import_zod.z.boolean());
const TaskSchema = import_zod.z.object({
  title: import_zod.z.string().min(1),
  impact: import_zod.z.coerce.number().int().min(1).max(5),
  urgency: import_zod.z.coerce.number().int().min(1).max(5),
  effort: import_zod.z.coerce.number().int().min(1).max(5),
  blocked: BooleanLikeSchema.default(false),
  owner: import_zod.z.string().min(1).optional(),
  dependencies: import_zod.z.object({
    item: import_zod.z.array(import_zod.z.string().min(1)).min(1).max(10)
  }).strict().optional(),
  labels: import_zod.z.object({
    item: import_zod.z.array(import_zod.z.string().min(1)).min(1).max(10)
  }).strict().optional()
}).strict();
const Schema = import_zod.z.object({
  strategy: import_zod.z.enum(["balanced", "urgent_first", "impact_first"]).default("balanced"),
  focusMode: import_zod.z.enum(["minimize_switching", "quick_wins", "deep_work"]).default("minimize_switching"),
  tasks: import_zod.z.object({
    item: import_zod.z.array(TaskSchema).min(1).max(40)
  }).strict()
}).strict().superRefine((value, context) => {
  const titles = new Set(value.tasks.item.map((task) => task.title));
  value.tasks.item.forEach((task, taskIndex) => {
    task.dependencies?.item.forEach((dependency, dependencyIndex) => {
      if (!titles.has(dependency)) {
        context.addIssue({
          code: "custom",
          message: `\u4F9D\u8D56\u4EFB\u52A1\u4E0D\u5B58\u5728\uFF1A${dependency}`,
          path: ["tasks", "item", taskIndex, "dependencies", "item", dependencyIndex]
        });
      }
    });
  });
});
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Schema
});
