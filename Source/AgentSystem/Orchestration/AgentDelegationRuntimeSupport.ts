import { AgentCancellationError, readAbortMessage } from "../Core/AgentCancellation.js";
import type { AgentChildRunDeadlinePolicy, AgentChildRunRecord } from "./AgentChildRunTypes.js";
import type { AgentChildRunCheckpoint } from "./AgentChildRunTypes.js";
import { AgentPromptWireEncodings, renderAgentPromptWireBlocks } from "../Prompt/AgentPromptContextWireRenderer.js";
import {
  parseAgentSubagentCapabilityCeiling,
  parseAgentSubagentLaunchContract,
  type AgentSubagentCapabilityCeiling,
} from "./AgentSubagentContracts.js";
import { resolveAgentDelegationConfiguration } from "./AgentOrchestrationConfig.js";
import type { AgentRunConcurrencyLimits } from "./AgentRunConcurrencyGate.js";
import type { AgentSubagentLaunchPlan } from "./AgentSubagentPreflight.js";

export function projectDelegationConcurrencyLimits(
  configuration: ReturnType<typeof resolveAgentDelegationConfiguration>,
): AgentRunConcurrencyLimits {
  return {
    maxConcurrentRuns: configuration.concurrency.maxRuns,
    maxConcurrentWorkspaceWriters: configuration.concurrency.maxWorkspaceWriters,
  };
}

export function restoreAgentSubagentLaunchPlan(record: AgentChildRunRecord): AgentSubagentLaunchPlan {
  const launchContract = parseAgentSubagentLaunchContract(record.launchContract);
  return {
    launchContract,
    promptLayer: record.executionContract.promptLayer,
    model: {
      ...(record.modelProviderId ? { selectedModelProviderId: record.modelProviderId } : {}),
      candidateModelProviderIds: record.executionContract.modelCandidateProviderIds,
      ...(record.modelSelectionSource ? { selectionSource: record.modelSelectionSource } : {}),
      ...(record.executionContract.thinkingLevel ? { thinkingLevel: record.executionContract.thinkingLevel } : {}),
    },
    pinnedSkills: record.selectedSkills,
    allowedToolNames: record.allowedToolNames,
    workspaceAccess: record.executionContract.workspaceAccess,
    inheritProjectContext: record.executionContract.inheritProjectContext,
    capabilityCeiling: readPersistedSubagentCapabilityCeiling(record),
    diagnostics: launchContract.diagnostics,
  };
}

export function readPersistedSubagentCapabilityCeiling(record: AgentChildRunRecord): AgentSubagentCapabilityCeiling {
  const launchContract = record.launchContract as {
    tools?: { capabilityCeiling?: unknown };
  };
  const candidate = record.executionContract.capabilityCeiling ?? launchContract.tools?.capabilityCeiling;
  return parseAgentSubagentCapabilityCeiling(candidate);
}

export function renderSupervisorResponsePrompt(message: string, checkpoint?: AgentChildRunCheckpoint): string {
  const instruction = [
    "Your supervisor responded to the decision request from the previous child turn:",
    message,
    "Continue the delegated task using this response, then return the result to the supervisor.",
  ].join("\n\n");
  if (!checkpoint) return instruction;

  const continuity = checkpoint.continuity;
  const resumeWire = renderAgentPromptWireBlocks(
    {
      preamble: [
        "senera.child_run_resume=v1",
        "provenance=host;not-user-input",
        "rule=resume-from-checkpoint;do-not-claim-unverified-state",
      ],
      blocks: [
        {
          id: "checkpoint",
          value: {
            capturedAt: checkpoint.capturedAt,
            source: checkpoint.source,
            complete: checkpoint.complete,
            ...(checkpoint.content ? { content: checkpoint.content } : {}),
            ...(continuity
              ? {
                  continuity: {
                    id: continuity.id,
                    revision: continuity.revision,
                    referenceIds: continuity.referenceIds,
                    ...(continuity.workspaceRevision ? { workspaceRevision: continuity.workspaceRevision } : {}),
                    resume: continuity.resume,
                  },
                }
              : {}),
          },
          allowedEncodings: [AgentPromptWireEncodings.Toon, AgentPromptWireEncodings.CompactJson],
        },
      ],
    },
    { estimateTokens: (text) => text.length },
  ).text;
  return `${instruction}\n\nUse this host-owned checkpoint as the starting coordinate; consult the referenced Artifact or workspace evidence before making new changes:\n\n${resumeWire}`;
}

export function waitForDelegationWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new AgentCancellationError(readAbortMessage(signal)));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new AgentCancellationError(readAbortMessage(signal)));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export function projectAgentChildRunDeadlinePolicy(
  configured: AgentChildRunDeadlinePolicy,
): AgentChildRunDeadlinePolicy {
  const projected = {
    softTimeoutMs: configured.softTimeoutMs,
    wrapUpTimeoutMs: configured.wrapUpTimeoutMs,
    snapshotIntervalMs: configured.snapshotIntervalMs,
    activityExtension: { ...configured.activityExtension },
  };
  assertDeadlinePolicy(projected);
  return projected;
}

export function parseAgentChildRunTimestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is not a valid timestamp: ${value}`);
  return parsed;
}

function assertDeadlinePolicy(policy: AgentChildRunDeadlinePolicy): void {
  const positiveValues = [
    ["soft timeout", policy.softTimeoutMs],
    ["wrap-up timeout", policy.wrapUpTimeoutMs],
    ["snapshot interval", policy.snapshotIntervalMs],
    ["recent activity window", policy.activityExtension.recentActivityWindowMs],
    ["extension step", policy.activityExtension.stepMs],
  ] as const;
  for (const [label, value] of positiveValues) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`Subagent ${label} must be a positive safe integer.`);
    }
  }
  if (!Number.isSafeInteger(policy.activityExtension.maximumMs) || policy.activityExtension.maximumMs < 0) {
    throw new Error("Subagent maximum activity extension must be a non-negative safe integer.");
  }
  if (policy.activityExtension.maximumMs > 0 && policy.activityExtension.stepMs > policy.activityExtension.maximumMs) {
    throw new Error("Subagent activity-extension step cannot exceed its maximum extension.");
  }
}
