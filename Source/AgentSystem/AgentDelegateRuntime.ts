import { z } from "zod";
import type { AgentHostToolHandler } from "./AgentToolHostCapabilityRegistry.js";
import type { AgentToolProcessRunResult } from "./AgentToolProcessRunner.js";
import { AgentToolProcessProtocol } from "./AgentToolProcessProtocol.js";
import {
  AgentExecutionErrorCodes,
  AgentToolProcessErrorPhases,
} from "./AgentXmlStatus.js";
import { throwIfAborted } from "./AgentCancellation.js";
import {
  normalizeToolArrayArgument,
  normalizeToolStringArgument,
} from "./AgentToolArgumentNormalization.js";
import { buildAgentDelegationPlan } from "./AgentDelegationPlan.js";
import { AgentDelegationRuntimeFactory } from "./AgentDelegationRuntimeFactory.js";

const AgentDelegateArgumentsSchema = z
  .object({
    workflow: z.preprocess(normalizeToolStringArgument, z.string().trim().min(1)),
    objective: z.preprocess(normalizeToolStringArgument, z.string().trim().min(1)).optional(),
    executionMode: z.preprocess(
      normalizeToolStringArgument,
      z.enum(["plan", "run"]).optional(),
    ),
    evidenceRefs: z.preprocess(normalizeToolArrayArgument, z.array(z.string().trim().min(1))).optional(),
    artifactUris: z.preprocess(normalizeToolArrayArgument, z.array(z.string().trim().min(1))).optional(),
  })
  .strict();

type AgentDelegateArguments = z.infer<typeof AgentDelegateArgumentsSchema>;

export const delegateAgentHostTool: AgentHostToolHandler = async (args, context) => {
  const parsed = AgentDelegateArgumentsSchema.safeParse(args);
  if (!parsed.success) {
    return delegateFailure({
      code: AgentExecutionErrorCodes.InvalidToolArguments,
      message: "AgentDelegateTool 参数无效。",
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        issues: parsed.error.issues,
        toolName: context.tool.name,
      },
      diagnostics: parsed.error.issues.map((issue) => ({
        message: issue.message,
        pointer: `/${issue.path.join("/")}`,
        path: issue.path.map((entry) => typeof entry === "number" ? entry : String(entry)),
      })),
    });
  }

  try {
    throwIfAborted(context.signal);
    const plan = buildAgentDelegationPlan(parsed.data, {
      registry: context.registry,
      workspaceRoot: context.workspaceRoot,
    });
    if (parsed.data.executionMode !== "run") {
      return delegateSuccess(plan);
    }

    if (!context.configPath) {
      throw new Error("AgentDelegateTool 执行子代理需要 configPath。");
    }

    const workflowRun = await new AgentDelegationRuntimeFactory({
      workspaceRoot: context.workspaceRoot,
      configPath: context.configPath,
      config: context.config,
    }).createWorkflowRunner().run({
      requestId: context.requestId ?? plan.workflow.name,
      step: context.step ?? 1,
      plan,
      latestUserRequest: parsed.data.objective ?? plan.objective ?? plan.workflow.description ?? plan.workflow.name,
      evidenceRefs: parsed.data.evidenceRefs,
      artifactUris: parsed.data.artifactUris,
      onEvent: context.onEvent,
      signal: context.signal,
    });

    return delegateSuccess({
      ...plan,
      execution: {
        mode: "agentLoop",
        status: "completed",
      },
      run: workflowRun,
    });
  } catch (error) {
    return delegateFailure({
      code: AgentExecutionErrorCodes.PluginExecutionError,
      message: error instanceof Error ? error.message : String(error),
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        toolName: context.tool.name,
      },
    });
  }
};

function delegateSuccess(result: unknown): AgentToolProcessRunResult {
  return {
    response: {
      protocol: AgentToolProcessProtocol,
      ok: true,
      result,
    },
    stdout: "",
    stderr: "",
    exitCode: null,
    signal: null,
  };
}

function delegateFailure(
  error: NonNullable<AgentToolProcessRunResult["response"]["error"]>,
): AgentToolProcessRunResult {
  return {
    response: {
      protocol: AgentToolProcessProtocol,
      ok: false,
      error,
    },
    stdout: "",
    stderr: "",
    exitCode: null,
    signal: null,
  };
}
