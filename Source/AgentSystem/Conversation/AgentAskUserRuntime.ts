import { z } from "zod";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import type { AgentHostToolHandler } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { toolProcessFailureResult, toolProcessSuccessResult } from "../ToolRuntime/AgentToolProcessEnvelope.js";

const AskUserArgumentsSchema = z
  .object({
    question: z.string().trim().min(1),
    reason_code: z.string().trim().min(1).optional(),
  })
  .strict();

export const askUserHostTool: AgentHostToolHandler = async (args) => {
  const parsed = AskUserArgumentsSchema.safeParse(args);
  if (!parsed.success) {
    return toolProcessFailureResult({
      code: AgentExecutionErrorCodes.InvalidToolArguments,
      message: "AskUserTool arguments are invalid.",
      details: {
        phase: AgentToolProcessErrorPhases.SchemaValidation,
        issues: parsed.error.issues,
      },
      diagnostics: parsed.error.issues.map((issue) => ({
        message: issue.message,
        path: issue.path.map((part) => (typeof part === "number" ? part : String(part))),
        pointer: `/${issue.path.join("/")}`,
      })),
    });
  }
  return toolProcessSuccessResult({
    control: {
      kind: "AskUser",
      question: parsed.data.question,
      reason_code: parsed.data.reason_code,
    },
  });
};
