"use strict";

const { runToolPlugin, z } = require("@senera/tool-plugin-sdk");

const AskUserToolArgumentsSchema = z.object({
  question: z.string().trim().min(1),
  reason_code: z.string().trim().min(1).optional()
}).strict();

const AskUserToolResultSchema = z.object({
  control: z.object({
    kind: z.literal("AskUser"),
    question: z.string().trim().min(1),
    reason_code: z.string().trim().min(1).optional()
  }).strict()
}).strict();

void runToolPlugin({
  toolName: "AskUserTool",
  argumentSchema: AskUserToolArgumentsSchema,
  resultSchema: AskUserToolResultSchema,
  execute(args) {
    return {
      control: {
        kind: "AskUser",
        question: args.question,
        reason_code: args.reason_code
      }
    };
  }
});
