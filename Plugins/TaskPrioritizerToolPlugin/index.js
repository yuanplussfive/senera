"use strict";
var import_plugin_sdk = require("@senera/tool-plugin-sdk");
var import_TaskPrioritizerToolArgumentsSchema = require("./Schemas/TaskPrioritizerToolArgumentsSchema.js");
var import_TaskPrioritizerToolResultSchema = require("./Schemas/TaskPrioritizerToolResultSchema.js");
void (0, import_plugin_sdk.runToolPlugin)({
  toolName: "TaskPrioritizerTool",
  argumentSchema: import_TaskPrioritizerToolArgumentsSchema.Schema,
  resultSchema: import_TaskPrioritizerToolResultSchema.Schema,
  execute(args) {
    const rankedTasks = args.tasks.item.map((task) => ({
      ...task,
      score: computeTaskScore({
        strategy: args.strategy,
        focusMode: args.focusMode,
        task
      })
    })).sort((left, right) => right.score - left.score || Number(left.blocked) - Number(right.blocked) || left.effort - right.effort || left.title.localeCompare(right.title)).map((task, index) => ({
      rank: index + 1,
      title: task.title,
      priorityBand: classifyPriorityBand(task.score, task.blocked),
      score: roundScore(task.score),
      blocked: task.blocked,
      owner: task.owner,
      labels: task.labels
    }));
    const prioritySummaryTemplate = ["critical", "high", "medium", "low"];
    const prioritySummary = prioritySummaryTemplate.map((band) => ({
      band,
      count: rankedTasks.filter((task) => task.priorityBand === band).length
    }));
    return {
      strategy: args.strategy,
      focusMode: args.focusMode,
      totalTasks: args.tasks.item.length,
      totalEffort: args.tasks.item.reduce((sum, task) => sum + task.effort, 0),
      blockedTaskCount: args.tasks.item.filter((task) => task.blocked).length,
      highPriorityTaskCount: rankedTasks.filter((task) => task.priorityBand === "critical" || task.priorityBand === "high").length,
      rankedTasks: {
        item: rankedTasks
      },
      prioritySummary: {
        item: prioritySummary
      },
      blockedTasks: {
        item: rankedTasks.filter((task) => task.blocked).map((task) => task.title)
      }
    };
  }
});
function computeTaskScore(options) {
  const strategyWeights = {
    balanced: { impact: 1.2, urgency: 1.2, effort: -0.7 },
    urgent_first: { impact: 1, urgency: 1.6, effort: -0.6 },
    impact_first: { impact: 1.7, urgency: 0.9, effort: -0.6 }
  };
  const focusAdjustments = {
    minimize_switching: options.task.labels?.item.length ? 0.4 : 0,
    quick_wins: options.task.effort <= 2 ? 1.1 : -0.2,
    deep_work: options.task.effort >= 4 ? 0.9 : 0
  };
  const dependencyPenalty = (options.task.dependencies?.item.length ?? 0) * 0.25;
  const blockedPenalty = options.task.blocked ? 5 : 0;
  const weight = strategyWeights[options.strategy];
  return options.task.impact * weight.impact + options.task.urgency * weight.urgency + options.task.effort * weight.effort + focusAdjustments[options.focusMode] - dependencyPenalty - blockedPenalty;
}
function classifyPriorityBand(score, blocked) {
  return blocked ? "low" : score >= 9 ? "critical" : score >= 7 ? "high" : score >= 4.5 ? "medium" : "low";
}
function roundScore(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
