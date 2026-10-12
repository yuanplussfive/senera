import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
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
import { DefaultAgentTimeZone } from "../Time/AgentTime.js";
import type { AgentContinuityMemOSRuntime } from "./AgentContinuityMemOSRuntime.js";
import { agentMemOSRevision, projectAgentMemOSOccurredAt, projectAgentMemOSPeriod } from "./AgentMemOSSemanticTypes.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { AgentMemOSReferenceSchema, agentMemOSReference } from "./AgentMemOSReference.js";
import type { AgentContinuityScoreBreakdown } from "./AgentContinuityMemoryTypes.js";

const NonEmptyText = z.string().trim().min(1);
export const ContinuityWriteArgumentsSchema = z
  .object({
    summary: NonEmptyText.describe("The explicit information the user asked Senera to remember."),
  })
  .strict();
export const ContinuityRecallArgumentsSchema = z
  .object({
    query: NonEmptyText.optional().describe("Natural-language description of the knowledge or completed scenario."),
    refs: z.array(AgentMemOSReferenceSchema).min(1).optional().describe("Exact memos:<node-id> references to read."),
    from: NonEmptyText.optional().describe("Start date (YYYY-MM-DD) or RFC 3339 instant. Dates use Asia/Shanghai."),
    to: NonEmptyText.optional().describe("Inclusive end date (YYYY-MM-DD), or exclusive RFC 3339 end instant."),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.query && !value.refs?.length && (!value.from || !value.to))
      context.addIssue({ code: "custom", message: "Memory recall requires query, refs, or a complete time range." });
    if ((value.from === undefined) !== (value.to === undefined))
      context.addIssue({ code: "custom", message: "Memory recall time ranges require both from and to." });
  });
export type ContinuityWriteToolArguments = z.infer<typeof ContinuityWriteArgumentsSchema>;
export type ContinuityRecallToolArguments = z.infer<typeof ContinuityRecallArgumentsSchema>;

export interface ContinuityRecallResult {
  readonly query?: string;
  readonly range?: { readonly from: string; readonly to: string; readonly timeZone: string };
  readonly budget: { readonly maxTokens: number; readonly matchedRecords: number; readonly returnedRecords: number };
  readonly records: {
    readonly item: readonly {
      readonly uri: string;
      readonly revision: string;
      readonly type: string;
      readonly content: string;
      readonly summary: string;
      readonly occurredAt: string;
      readonly score: number;
      readonly matchedBy: readonly string[];
      readonly scores?: AgentContinuityScoreBreakdown;
      readonly period?: { readonly granularity: "day" | "month"; readonly start: string; readonly end: string };
    }[];
  };
}
export interface AgentContinuityRecallService {
  recall(
    args: ContinuityRecallToolArguments,
    input: { readonly sessionId?: string; readonly signal?: AbortSignal },
  ): Promise<ContinuityRecallResult>;
}
export function createAgentContinuityRecallService(input: {
  readonly memos: AgentContinuityMemOSRuntime;
  readonly configSnapshot: () => AgentSystemConfig;
}): AgentContinuityRecallService {
  return {
    recall: (args, request) => {
      const config = input.configSnapshot();
      const estimator = new AgentModelTokenEstimator({ model: resolveModelProviderConfig(config).Model });
      return recallContinuity(args, {
        memos: input.memos,
        signal: request.signal,
        tokenBudget: {
          maxTokens: resolveContinuityLearningConfig(config).Recall.PromptBudget.MaxTokens,
          estimateTokens: (text) => estimator.estimate(text).tokenCount,
        },
      });
    },
  };
}

/** A deferred learning intent, committed only when the turn completes normally. */
export const writeContinuityHostTool: AgentHostToolHandler = async (args, context) => {
  const parsed = ContinuityWriteArgumentsSchema.safeParse(args);
  if (!parsed.success) return toolValidationFailure(parsed.error, context.tool.name);
  throwIfAborted(context.signal);
  return toolProcessSuccessResult({
    status: "accepted_for_learning",
    records: { item: [{ summary: parsed.data.summary }] },
  });
};
export function createRecallContinuityHostTool(service?: AgentContinuityRecallService): AgentHostToolHandler {
  return async (args, context) => {
    const parsed = ContinuityRecallArgumentsSchema.safeParse(args);
    if (!parsed.success) return toolValidationFailure(parsed.error, context.tool.name);
    if (!service)
      return toolFailure(new Error("MemOS recall service is not bound to this runtime."), context.tool.name);
    try {
      throwIfAborted(context.signal);
      return toolProcessSuccessResult(
        await service.recall(parsed.data, { sessionId: context.sessionId, signal: context.signal }),
      );
    } catch (error) {
      throwIfAborted(context.signal);
      return toolFailure(error, context.tool.name);
    }
  };
}
export const recallContinuityHostTool: AgentHostToolHandler = createRecallContinuityHostTool();

export async function recallContinuity(
  args: ContinuityRecallToolArguments,
  options: {
    readonly memos: Pick<AgentContinuityMemOSRuntime, "recall">;
    readonly tokenBudget: AgentContinuityHistoricalTokenBudget;
    readonly signal?: AbortSignal;
  },
): Promise<ContinuityRecallResult> {
  throwIfAborted(options.signal);
  const range = args.from && args.to ? agentMemoryDateRange(args.from, args.to) : undefined;
  const results = await options.memos.recall({
    query: args.query,
    nodeIds: args.refs,
    range,
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
    options.tokenBudget.estimateTokens(JSON.stringify(createToolProcessSuccessResponse(buildResult(items))));
  if (measure([]) > maxTokens) throw new Error("Memory recall token budget cannot fit result metadata.");
  const covered = new Set<string>();
  for (const result of results) {
    const { node, score, scores } = result.memory;
    const uri = agentMemOSReference(node.id);
    if (covered.has(uri + "@" + agentMemOSRevision(node))) continue;
    const period = projectAgentMemOSPeriod(node.tags);
    const record = {
      uri,
      revision: agentMemOSRevision(node),
      type: node.type,
      content: node.content,
      summary: node.summary,
      occurredAt: projectAgentMemOSOccurredAt(node),
      score,
      matchedBy: ["memos", ...Object.keys(scores ?? {})],
      ...(scores ? { scores: { ...scores } } : {}),
      ...(period ? { period } : {}),
    };
    if (measure([...records, record]) > maxTokens) continue;
    records.push(record);
    for (const key of result.deliveryKeys ?? [uri + "@" + record.revision]) covered.add(key);
  }
  return buildResult(records);
}

function agentMemoryDateRange(from: string, to: string) {
  const startMs = parseBoundary(from, false);
  const endMs = parseBoundary(to, true);
  if (endMs <= startMs) throw new Error("Memory recall range must end after it starts.");
  return {
    startMs,
    endMs,
    start: Temporal.Instant.fromEpochMilliseconds(startMs).toString(),
    end: Temporal.Instant.fromEpochMilliseconds(endMs).toString(),
  };
}
function parseBoundary(value: string, end: boolean): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const start = Temporal.PlainDate.from(value).toZonedDateTime(DefaultAgentTimeZone).startOfDay();
    return (end ? start.add({ days: 1 }) : start).epochMilliseconds;
  }
  return Temporal.Instant.from(value).epochMilliseconds;
}
function toolValidationFailure(error: z.ZodError, tool: string) {
  return toolProcessFailureResult({
    code: AgentExecutionErrorCodes.InvalidToolArguments,
    message: error.message,
    details: { phase: AgentToolProcessErrorPhases.SchemaValidation, tool },
  });
}
function toolFailure(error: unknown, tool: string) {
  return toolProcessFailureResult({
    code: AgentExecutionErrorCodes.ToolExecutionError,
    message: errorMessage(error),
    details: { phase: AgentToolProcessErrorPhases.RuntimeExecution, tool },
  });
}
