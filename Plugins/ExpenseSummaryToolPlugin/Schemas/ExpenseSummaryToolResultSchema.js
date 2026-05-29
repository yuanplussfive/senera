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
var ExpenseSummaryToolResultSchema_exports = {};
__export(ExpenseSummaryToolResultSchema_exports, {
  Schema: () => Schema
});
module.exports = __toCommonJS(ExpenseSummaryToolResultSchema_exports);
var import_zod = require("@senera/tool-plugin-sdk");
const CategorySummarySchema = import_zod.z.object({
  category: import_zod.z.string(),
  count: import_zod.z.number().int(),
  totalAmount: import_zod.z.number()
}).strict();
const PayerSummarySchema = import_zod.z.object({
  payer: import_zod.z.string(),
  totalPaid: import_zod.z.number()
}).strict();
const SettlementSchema = import_zod.z.object({
  name: import_zod.z.string(),
  paidAmount: import_zod.z.number(),
  owedAmount: import_zod.z.number(),
  balance: import_zod.z.number(),
  direction: import_zod.z.enum(["receive", "pay", "settled"])
}).strict();
const Schema = import_zod.z.object({
  currency: import_zod.z.string(),
  roundingMode: import_zod.z.string(),
  transactionCount: import_zod.z.number().int(),
  totalAmount: import_zod.z.number(),
  averageAmount: import_zod.z.number(),
  largestTransaction: import_zod.z.object({
    title: import_zod.z.string(),
    amount: import_zod.z.number(),
    category: import_zod.z.string(),
    paidBy: import_zod.z.string()
  }).strict(),
  categoryBreakdown: import_zod.z.object({
    item: import_zod.z.array(CategorySummarySchema).min(1)
  }).strict(),
  payerBreakdown: import_zod.z.object({
    item: import_zod.z.array(PayerSummarySchema).min(1)
  }).strict(),
  settlement: import_zod.z.object({
    item: import_zod.z.array(SettlementSchema).min(1)
  }).strict()
}).strict();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Schema
});
