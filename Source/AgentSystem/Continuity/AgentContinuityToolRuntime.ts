import { throwIfAborted } from "../Core/AgentCancellation.js";
import { errorMessage } from "../Core/AgentErrors.js";
import type { AgentHostToolHandler } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import {
  createToolProcessSuccessResponse,
  toolProcessFailureResult,
  toolProcessSuccessResult,
} from "../ToolRuntime/AgentToolProcessEnvelope.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import { resolveContinuityLearningConfig, resolveModelProviderConfig } from "../AgentDefaults.js";
import { AgentModelTokenEstimator } from "../Text/AgentTextBudget.js";
import type { AgentContinuityHistoricalTokenBudget } from "./AgentContinuityPromptBudget.js";
import { DefaultAgentTimeZone, formatAgentTimeOffset, parseAgentTimeBoundary } from "../Time/AgentTime.js";
import type { AgentContinuityMemOSRuntime } from "./AgentContinuityMemOSRuntime.js";
import { agentMemOSRevision, projectAgentMemOSOccurredAt, projectAgentMemOSPeriod } from "./AgentMemOSSemanticTypes.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { agentMemOSReference, parseAgentMemOSReference } from "./AgentMemOSReference.js";
import { systemToolArguments } from "../SystemTools/AgentSystemToolDefinition.js";
import type { AgentMemoryLearningLedger } from "./AgentMemoryLearningLedger.js";
import { agentMemoryQualityWeight, agentMemoryRelevance } from "./AgentMemoryRecallRanking.js";
import {
  AgentMemoryRecallToolResultSchema,
  AgentMemoryRecallToolResultJsonSchema,
  type AgentMemoryRecallToolResult,
} from "./AgentMemoryRecallToolContract.js";
import { projectAgentToolModelOutput } from "../ToolContracts/AgentToolModelOutput.js";
import { agentMemorySubject, type AgentMemorySubject } from "./AgentMemoryLearningLedger.js";
import type { AgentInteractionContext } from "../Interaction/AgentInteractionContext.js";

/** Package-validated public input for MemoryWriteTool. */
export interface ContinuityWriteToolArguments {
  readonly summary: string;
}

/** Package-validated public input for MemoryRecallTool. */
export interface ContinuityRecallToolArguments {
  readonly query?: string;
  readonly refs?: readonly string[];
  readonly from?: string;
  readonly to?: string;
}

export type ContinuityRecallResult = AgentMemoryRecallToolResult;
export interface AgentContinuityRecallService {
  recall(
    args: ContinuityRecallToolArguments,
    input: {
      readonly sessionId?: string;
      readonly requestId?: string;
      readonly signal?: AbortSignal;
      readonly interaction?: AgentInteractionContext;
    },
  ): Promise<ContinuityRecallResult>;
}
export function createAgentContinuityRecallService(input: {
  readonly memos: AgentContinuityMemOSRuntime;
  readonly configSnapshot: () => AgentSystemConfig;
  readonly learningLedger?: AgentMemoryLearningLedger;
}): AgentContinuityRecallService {
  return {
    recall: async (args, request) => {
      const config = input.configSnapshot();
      const estimator = new AgentModelTokenEstimator({ model: resolveModelProviderConfig(config).Model });
      // Invalid producer results must not create delivery receipts before the tool boundary rejects them.
      const result = AgentMemoryRecallToolResultSchema.parse(
        await recallContinuity(args, {
          memos: input.memos,
          subject: agentMemorySubject(request.interaction),
          signal: request.signal,
          tokenBudget: {
            maxTokens: resolveContinuityLearningConfig(config).Recall.PromptBudget.MaxTokens,
            estimateTokens: (text) => estimator.estimate(text).tokenCount,
          },
        }),
      );
      if (request.sessionId && request.requestId && input.learningLedger) {
        input.learningLedger.stageDelivery(
          request.sessionId,
          request.requestId,
          result.records.item.map((entry) => ({
            id: parseAgentMemOSReference(entry.uri),
            revision: entry.revision,
            summary: entry.summary,
          })),
          "explicit",
        );
      }
      return result;
    },
  };
}

/** A deferred learning intent, committed only when the turn completes normally. */
export const writeContinuityHostTool: AgentHostToolHandler = async (args, context) => {
  const input = systemToolArguments<ContinuityWriteToolArguments>(args);
  throwIfAborted(context.signal);
  return toolProcessSuccessResult({
    status: "accepted_for_learning",
    records: { item: [{ summary: input.summary }] },
  });
};
export function createRecallContinuityHostTool(service: AgentContinuityRecallService): AgentHostToolHandler {
  return async (args, context) => {
    const input = systemToolArguments<ContinuityRecallToolArguments>(args);
    try {
      throwIfAborted(context.signal);
      return toolProcessSuccessResult(
        await service.recall(input, {
          sessionId: context.sessionId,
          requestId: context.requestId,
          interaction: context.interaction,
          signal: context.signal,
        }),
      );
    } catch (error) {
      throwIfAborted(context.signal);
      return toolFailure(error, context.tool.name);
    }
  };
}

export async function recallContinuity(
  args: ContinuityRecallToolArguments,
  options: {
    readonly memos: Pick<AgentContinuityMemOSRuntime, "recall">;
    readonly tokenBudget: AgentContinuityHistoricalTokenBudget;
    readonly signal?: AbortSignal;
    readonly subject?: AgentMemorySubject;
  },
): Promise<ContinuityRecallResult> {
  throwIfAborted(options.signal);
  const range = args.from && args.to ? agentMemoryDateRange(args.from, args.to) : undefined;
  const results = await options.memos.recall({
    query: args.query,
    nodeIds: args.refs?.map(parseAgentMemOSReference),
    range,
    subject: options.subject,
  });
  throwIfAborted(options.signal);
  const maxTokens = Math.max(0, Math.floor(options.tokenBudget.maxTokens));
  const records: ContinuityRecallResult["records"]["item"][number][] = [];
  const buildResult = (items: ContinuityRecallResult["records"]["item"]): ContinuityRecallResult => ({
    ...(args.query ? { query: args.query } : {}),
    ...(range ? { range: { from: range.start, to: range.end, timeZone: DefaultAgentTimeZone } } : {}),
    budget: { maxTokens, matchedRecords: results.length, returnedRecords: items.length },
    records: { item: items },
  });
  const measure = (items: ContinuityRecallResult["records"]["item"]) =>
    options.tokenBudget.estimateTokens(
      JSON.stringify(
        createToolProcessSuccessResponse(
          projectAgentToolModelOutput(buildResult(items), AgentMemoryRecallToolResultJsonSchema),
        ),
      ),
    );
  if (measure([]) > maxTokens) throw new Error("Memory recall token budget cannot fit result metadata.");
  const covered = new Set<string>();
  const ranked = results
    .map((result) => ({
      ...result,
      score: (args.query?.trim() ? agentMemoryRelevance(result.memory) : 1) * agentMemoryQualityWeight(result.quality),
    }))
    .sort((left, right) => right.score - left.score || left.memory.node.id.localeCompare(right.memory.node.id));
  for (const result of ranked) {
    const { node, scores } = result.memory;
    const uri = agentMemOSReference(node.id);
    const revision = agentMemOSRevision(node);
    if (covered.has(uri + "@" + revision)) continue;
    const period = projectAgentMemOSPeriod(node);
    const record = {
      uri,
      revision,
      type: node.type,
      content: node.content,
      summary: node.summary,
      occurredAt: projectAgentMemOSOccurredAt(node),
      score: result.score,
      ...(result.quality ? { quality: result.quality } : {}),
      matchedBy: ["memos", ...Object.keys(scores ?? {})],
      ...(scores ? { scores: { ...scores } } : {}),
      ...(period ? { period } : {}),
    };
    if (measure([...records, record]) > maxTokens) continue;
    records.push(record);
    for (const key of result.dedupeKeys ?? [uri + "@" + record.revision]) covered.add(key);
  }
  return buildResult(records);
}

function agentMemoryDateRange(from: string, to: string) {
  const startMs = parseAgentTimeBoundary(from, "start");
  const endMs = parseAgentTimeBoundary(to, "end-exclusive");
  if (endMs <= startMs) throw new Error("Memory recall range must end after it starts.");
  return {
    startMs,
    endMs,
    start: formatAgentTimeOffset(new Date(startMs).toISOString()),
    end: formatAgentTimeOffset(new Date(endMs).toISOString()),
  };
}
function toolFailure(error: unknown, tool: string) {
  return toolProcessFailureResult({
    code: AgentExecutionErrorCodes.ToolExecutionError,
    message: errorMessage(error),
    details: { phase: AgentToolProcessErrorPhases.RuntimeExecution, tool },
  });
}
