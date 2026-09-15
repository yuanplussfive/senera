import path from "node:path";
import { errorMessage } from "../Core/AgentErrors.js";
import { AgentWorkspaceResourceDomains, classifyAgentWorkspaceResource } from "../Core/AgentWorkspaceLayout.js";
import { AgentResourceAccessAuthorities } from "../Execution/SeneraResourceAccess.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import { AgentExtensionPatchPreflightError } from "../ManagedExtensions/AgentExtensionPatchCandidate.js";
import { AgentExtensionPatchPreflight } from "../ManagedExtensions/AgentExtensionPatchPreflight.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import { WorkspaceApplyPatchArgumentsSchema } from "./AgentWorkspaceApplyPatchContract.js";
import { WorkspaceApplyPatchError, type WorkspacePatchFailureInput } from "./AgentWorkspacePatchError.js";
import { buildWorkspacePatchPlan, collectWorkspacePatchChangedPaths } from "./AgentWorkspacePatchPlanBuilder.js";
import {
  applyWorkspacePatchTransaction,
  validateWorkspacePatchPreconditions,
} from "./AgentWorkspacePatchTransaction.js";
import type { AgentHostToolHandler } from "./AgentToolHostCapabilityRegistry.js";
import { openAgentHostToolReportingScope } from "./AgentToolHostCapabilityRegistry.js";
import { toolProcessFailureResult, toolProcessSuccessResult } from "./AgentToolProcessEnvelope.js";
import type { AgentToolProcessRunResult } from "./AgentToolProcessTypes.js";

interface WorkspacePatchAttemptSummary {
  readonly state: "planned" | "validated" | "validation-failed";
  readonly activeChanged: false;
  readonly operationCount: number;
  readonly changedPaths: readonly string[];
  readonly extension?: { readonly kind: "Skill" | "MCP"; readonly name: string };
}

export const applyWorkspacePatchHostTool: AgentHostToolHandler = async (args, context) => {
  const parsed = WorkspaceApplyPatchArgumentsSchema.safeParse(args);
  if (!parsed.success) {
    return workspacePatchFailure({
      code: AgentExecutionErrorCodes.InvalidToolArguments,
      message: agentErrorMessage("workspacePatch.argumentsInvalid"),
      diagnostics: parsed.error.issues.map((issue) => ({
        message: issue.message,
        pointer: `/${issue.path.join("/")}`,
        path: issue.path.map((entry) => (typeof entry === "number" ? entry : String(entry))),
      })),
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        issues: parsed.error.issues,
        toolName: context.tool.name,
      },
    });
  }

  const reporting = openAgentHostToolReportingScope(context);
  let attempt: WorkspacePatchAttemptSummary | undefined;
  try {
    const plan = await buildWorkspacePatchPlan(parsed.data, context.workspaceRoot, context.executionEnv);
    const changedPaths = collectWorkspacePatchChangedPaths(plan);
    attempt = {
      state: "planned",
      activeChanged: false,
      operationCount: plan.operations.length,
      changedPaths,
    };
    const totalStages = plan.dryRun ? 2 : 4;
    reporting.reporter.progress({
      message: "Workspace patch planned.",
      completed: 1,
      total: totalStages,
      unit: "stage",
    });
    const extensionValidations = new AgentExtensionPatchPreflight(context.workspaceRoot, context.registry).validate(
      plan,
      changedPaths,
    );
    attempt = { ...attempt, state: "validated" };
    const commitEnv = requiresManagedExtensionPublication(context.workspaceRoot, changedPaths)
      ? context.executionEnv.withResourceAccessAuthority(AgentResourceAccessAuthorities.ManagedExtensionPublisher)
      : context.executionEnv;
    reporting.reporter.progress({
      message: "Managed extension candidates validated.",
      completed: 2,
      total: totalStages,
      unit: "stage",
    });
    if (!plan.dryRun) {
      await validateWorkspacePatchPreconditions(plan, context.executionEnv);
      reporting.reporter.progress({
        message: "Workspace patch preconditions validated.",
        completed: 3,
        total: totalStages,
        unit: "stage",
      });
      await applyWorkspacePatchTransaction(plan, commitEnv);
      reporting.reporter.progress({
        message: "Workspace patch applied.",
        completed: 4,
        total: totalStages,
        unit: "stage",
      });
    }

    return toolProcessSuccessResult({
      text: plan.dryRun
        ? `Workspace patch dry run validated ${plan.operations.length} operation(s) over ${changedPaths.length} path(s).`
        : `Workspace patch applied ${plan.operations.length} operation(s) over ${changedPaths.length} path(s).`,
      applied: !plan.dryRun,
      dryRun: plan.dryRun,
      fuzzFactor: plan.fuzzFactor,
      operationCount: plan.operations.length,
      changedPaths,
      operations: plan.operations,
      extensions: extensionValidations,
    });
  } catch (error) {
    if (error instanceof AgentExtensionPatchPreflightError) {
      return workspacePatchFailure({
        code: AgentExecutionErrorCodes.InvalidToolArguments,
        message: error.message,
        diagnostics: [...error.diagnostics],
        details: {
          phase: AgentToolProcessErrorPhases.RuntimeExecution,
          toolName: context.tool.name,
          requestId: context.requestId,
          extensionKind: error.extensionKind,
          extensionName: error.extensionName,
          attempt: attempt && {
            ...attempt,
            state: "validation-failed",
            extension: { kind: error.extensionKind, name: error.extensionName },
          },
        },
      });
    }
    return error instanceof WorkspaceApplyPatchError
      ? workspacePatchFailure(error.toFailureInput(context.tool.name))
      : workspacePatchFailure({
          code: AgentExecutionErrorCodes.ToolExecutionError,
          message: errorMessage(error),
          details: { phase: AgentToolProcessErrorPhases.RuntimeExecution, toolName: context.tool.name },
        });
  } finally {
    await reporting.close();
  }
};

function requiresManagedExtensionPublication(workspaceRoot: string, changedPaths: readonly string[]): boolean {
  return changedPaths.some((changedPath) => {
    const domain = classifyAgentWorkspaceResource(workspaceRoot, path.resolve(workspaceRoot, changedPath)).domain;
    return domain === AgentWorkspaceResourceDomains.ManagedSkill || domain === AgentWorkspaceResourceDomains.ManagedMcp;
  });
}

function workspacePatchFailure(input: WorkspacePatchFailureInput): AgentToolProcessRunResult {
  return toolProcessFailureResult({
    code: input.code,
    message: input.message,
    diagnostics: input.diagnostics,
    details: input.details,
  });
}
