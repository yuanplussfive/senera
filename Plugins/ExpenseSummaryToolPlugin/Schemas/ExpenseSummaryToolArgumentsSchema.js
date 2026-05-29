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
var ExpenseSummaryToolArgumentsSchema_exports = {};
__export(ExpenseSummaryToolArgumentsSchema_exports, {
  Schema: () => Schema
});
module.exports = __toCommonJS(ExpenseSummaryToolArgumentsSchema_exports);
var import_zod = require("@senera/tool-plugin-sdk");
const ParticipantSchema = import_zod.z.object({
  name: import_zod.z.string().min(1),
  weight: import_zod.z.coerce.number().positive().default(1)
}).strict();
const TransactionSchema = import_zod.z.object({
  title: import_zod.z.string().min(1),
  amount: import_zod.z.coerce.number().positive(),
  category: import_zod.z.enum(["transport", "lodging", "food", "tickets", "supplies", "other"]),
  paidBy: import_zod.z.string().min(1),
  participants: import_zod.z.object({
    item: import_zod.z.array(ParticipantSchema).min(1).max(20)
  }).strict(),
  tags: import_zod.z.object({
    item: import_zod.z.array(import_zod.z.string().min(1)).min(1).max(12)
  }).strict().optional()
}).strict();
const Schema = import_zod.z.object({
  currency: import_zod.z.enum(["CNY", "USD", "EUR"]).default("CNY"),
  roundingMode: import_zod.z.enum(["nearest_cent", "up_cent", "down_cent"]).default("nearest_cent"),
  transactions: import_zod.z.object({
    item: import_zod.z.array(TransactionSchema).min(1).max(50)
  }).strict()
}).strict();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Schema
});
