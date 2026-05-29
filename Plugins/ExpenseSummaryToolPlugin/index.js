"use strict";
var import_plugin_sdk = require("@senera/tool-plugin-sdk");
var import_ExpenseSummaryToolArgumentsSchema = require("./Schemas/ExpenseSummaryToolArgumentsSchema.js");
var import_ExpenseSummaryToolResultSchema = require("./Schemas/ExpenseSummaryToolResultSchema.js");
void (0, import_plugin_sdk.runToolPlugin)({
  toolName: "ExpenseSummaryTool",
  argumentSchema: import_ExpenseSummaryToolArgumentsSchema.Schema,
  resultSchema: import_ExpenseSummaryToolResultSchema.Schema,
  execute(args) {
    const transactions = args.transactions.item;
    const round = createRounder(args.roundingMode);
    const categoryTotals = /* @__PURE__ */ new Map();
    const payerTotals = /* @__PURE__ */ new Map();
    const participantOwedTotals = /* @__PURE__ */ new Map();
    let totalAmount = 0;
    let largestTransaction = transactions[0];
    for (const transaction of transactions) {
      totalAmount += transaction.amount;
      if (transaction.amount > largestTransaction.amount) {
        largestTransaction = transaction;
      }
      categoryTotals.set(transaction.category, {
        count: (categoryTotals.get(transaction.category)?.count ?? 0) + 1,
        totalAmount: (categoryTotals.get(transaction.category)?.totalAmount ?? 0) + transaction.amount
      });
      payerTotals.set(
        transaction.paidBy,
        (payerTotals.get(transaction.paidBy) ?? 0) + transaction.amount
      );
      const totalWeight = transaction.participants.item.reduce(
        (sum, participant) => sum + participant.weight,
        0
      );
      for (const participant of transaction.participants.item) {
        participantOwedTotals.set(
          participant.name,
          (participantOwedTotals.get(participant.name) ?? 0) + transaction.amount * participant.weight / totalWeight
        );
      }
    }
    const settlementNames = /* @__PURE__ */ new Set([
      ...payerTotals.keys(),
      ...participantOwedTotals.keys()
    ]);
    return {
      currency: args.currency,
      roundingMode: args.roundingMode,
      transactionCount: transactions.length,
      totalAmount: round(totalAmount),
      averageAmount: round(totalAmount / transactions.length),
      largestTransaction: {
        title: largestTransaction.title,
        amount: round(largestTransaction.amount),
        category: largestTransaction.category,
        paidBy: largestTransaction.paidBy
      },
      categoryBreakdown: {
        item: [...categoryTotals.entries()].map(([category, value]) => ({
          category,
          count: value.count,
          totalAmount: round(value.totalAmount)
        })).sort((left, right) => right.totalAmount - left.totalAmount || left.category.localeCompare(right.category))
      },
      payerBreakdown: {
        item: [...payerTotals.entries()].map(([payer, value]) => ({
          payer,
          totalPaid: round(value)
        })).sort((left, right) => right.totalPaid - left.totalPaid || left.payer.localeCompare(right.payer))
      },
      settlement: {
        item: [...settlementNames].map((name) => {
          const paidAmount = round(payerTotals.get(name) ?? 0);
          const owedAmount = round(participantOwedTotals.get(name) ?? 0);
          const balance = round(paidAmount - owedAmount);
          return {
            name,
            paidAmount,
            owedAmount,
            balance,
            direction: classifySettlementDirection(balance)
          };
        }).sort((left, right) => Math.abs(right.balance) - Math.abs(left.balance) || left.name.localeCompare(right.name))
      }
    };
  }
});
function createRounder(mode) {
  const operators = {
    nearest_cent: Math.round,
    up_cent: Math.ceil,
    down_cent: Math.floor
  };
  return (value) => operators[mode]((value + Number.EPSILON) * 100) / 100;
}
function classifySettlementDirection(balance) {
  return balance > 4e-3 ? "receive" : balance < -4e-3 ? "pay" : "settled";
}
