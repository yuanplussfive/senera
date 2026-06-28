import path from "node:path";
import type { AgentHostToolHandler } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { toolProcessSuccessResult } from "../ToolRuntime/AgentToolProcessEnvelope.js";
import {
  AgentExecutionErrorCodes,
  AgentToolProcessErrorPhases,
} from "../Xml/AgentXmlStatus.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import {
  ApplyPatchArgumentsSchema,
  type ApplyPatchArguments,
} from "./AgentPatchApplyTypes.js";
import { buildWritePlan } from "./AgentPatchPlanner.js";
import { commitWritePlan } from "./AgentPatchCommitter.js";
import { resolveWorkspaceCwd } from "./AgentPatchPathResolver.js";
import {
  normalizePatchError,
  patchFailure,
} from "./AgentPatchErrorProjection.js";

export const applyPatchHostTool: AgentHostToolHandler = async (args, context) => {
  const parsed = ApplyPatchArgumentsSchema.safeParse(args);
  if (!parsed.success) {
    return patchFailure({
      code: AgentExecutionErrorCodes.InvalidToolArguments,
      message: "ApplyPatchTool 参数无效。",
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
    const result = await applyPatch(parsed.data, context.workspaceRoot, context.signal);
    return toolProcessSuccessResult(result);
  } catch (error) {
    const normalized = normalizePatchError(error);
    return patchFailure({
      code: AgentExecutionErrorCodes.PluginExecutionError,
      message: normalized.message,
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        toolName: context.tool.name,
      },
      diagnostics: normalized.diagnostics.map((message) => ({
        message,
        pointer: normalized.pointer,
        path: [],
      })),
    });
  }
};

async function applyPatch(args: ApplyPatchArguments, workspaceRoot: string, signal?: AbortSignal) {
  const root = path.resolve(workspaceRoot);
  const cwd = resolveWorkspaceCwd(root, args.cwd);
  const plan = await buildWritePlan(root, cwd, args.operations.item);
  throwIfAborted(signal);

  if (!args.dryRun) {
    await commitWritePlan(plan, signal);
  }

  return {
    dryRun: args.dryRun,
    changedFiles: {
      item: plan.map((entry) => ({
        path: entry.relativePath,
        status: entry.status,
        additions: entry.additions,
        deletions: entry.deletions,
      })),
    },
    diagnostics: {
      item: [
        args.dryRun
          ? `编辑计划校验通过，dryRun 未写入文件，共 ${plan.length} 个文件。`
          : `编辑已应用，共 ${plan.length} 个文件。`,
      ],
    },
  };
}
