import type { AgentLanguageModelRequest } from "./AgentLanguageModel.js";
import { AgentModelTokenEstimator } from "../Text/AgentTextBudget.js";
import { AsyncLocalStorage } from "node:async_hooks";

export const AgentModelUsageSources = {
  ProviderReported: "provider_reported",
  Mixed: "mixed",
  LocalEstimate: "local_estimate",
  Unavailable: "unavailable",
} as const;

export type AgentModelUsageSource = (typeof AgentModelUsageSources)[keyof typeof AgentModelUsageSources];

export const AgentModelUsageFields = [
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "reasoningTokens",
] as const;

export type AgentModelUsageField = (typeof AgentModelUsageFields)[number];

export interface AgentModelUsageValue {
  source: AgentModelUsageSource;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  estimatedFields?: AgentModelUsageField[];
}

export interface AgentModelUsageCall {
  stage: string;
  usage: AgentModelUsageValue;
}

export interface AgentModelUsage extends AgentModelUsageValue {
  calls?: AgentModelUsageCall[];
}

export type AgentProviderReportedUsage = Partial<
  Pick<
    AgentModelUsageValue,
    "inputTokens" | "outputTokens" | "totalTokens" | "cacheReadTokens" | "cacheWriteTokens" | "reasoningTokens"
  >
>;

export type AgentModelUsageSink = (call: AgentModelUsageCall) => void;

const AdditiveUsageFields = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "reasoningTokens",
] as const satisfies readonly AgentModelUsageField[];

const AgentModelUsageContext = new AsyncLocalStorage<AgentModelUsageLedger>();

export function createProviderReportedUsage(input: AgentProviderReportedUsage): AgentModelUsageValue | undefined {
  const usage = Object.fromEntries(
    AgentModelUsageFields.flatMap((field) => {
      const value = normalizeTokenCount(input[field]);
      return value === undefined ? [] : [[field, value]];
    }),
  ) as AgentProviderReportedUsage;
  if (Object.keys(usage).length === 0) return undefined;

  const knownTotal = sumPresentUsageFields(usage, [
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
  ]);
  const totalTokens =
    usage.totalTokens === undefined
      ? usage.inputTokens !== undefined && usage.outputTokens !== undefined
        ? knownTotal
        : undefined
      : Math.max(usage.totalTokens, knownTotal);
  return {
    source: AgentModelUsageSources.ProviderReported,
    ...usage,
    totalTokens,
  };
}

export class AgentModelUsageResolver {
  private readonly estimator: AgentModelTokenEstimator;

  constructor(model: string) {
    this.estimator = new AgentModelTokenEstimator({ model });
  }

  resolve(
    request: Pick<AgentLanguageModelRequest, "systemPrompt" | "messages">,
    outputText: string,
    reported?: AgentModelUsageValue,
  ): AgentModelUsageValue {
    const estimates = {
      inputTokens: this.estimator.estimate(serializeModelInput(request)).tokenCount,
      outputTokens: this.estimator.estimate(outputText).tokenCount,
    };
    const estimatedTokenFields = (["inputTokens", "outputTokens"] as const).filter(
      (field) => reported?.[field] === undefined,
    );
    const estimatedFields: AgentModelUsageField[] = [
      ...estimatedTokenFields,
      ...(reported?.totalTokens === undefined ? (["totalTokens"] as const) : []),
    ];
    const inputTokens = reported?.inputTokens ?? estimates.inputTokens;
    const outputTokens = reported?.outputTokens ?? estimates.outputTokens;
    const cacheReadTokens = reported?.cacheReadTokens;
    const cacheWriteTokens = reported?.cacheWriteTokens;
    const computedTotal = inputTokens + outputTokens + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0);

    return {
      source: resolveCompletedUsageSource(reported, estimatedTokenFields.length),
      inputTokens,
      outputTokens,
      totalTokens: Math.max(reported?.totalTokens ?? 0, computedTotal),
      cacheReadTokens,
      cacheWriteTokens,
      reasoningTokens: reported?.reasoningTokens,
      estimatedFields: estimatedFields.length > 0 ? estimatedFields : undefined,
    };
  }
}

export class AgentModelUsageLedger {
  private readonly calls: AgentModelUsageCall[] = [];

  record(call: AgentModelUsageCall): void {
    this.calls.push({
      stage: call.stage,
      usage: cloneUsageValue(call.usage),
    });
  }

  aggregate(): AgentModelUsage | undefined {
    if (this.calls.length === 0) return undefined;
    const values = this.calls.map((call) => call.usage);
    const estimatedFields = uniqueEstimatedFields(values);
    const aggregate = Object.fromEntries(
      AdditiveUsageFields.flatMap((field) => {
        const valuesForField = values.flatMap((usage) => (usage[field] === undefined ? [] : [usage[field]]));
        return valuesForField.length === 0 ? [] : [[field, valuesForField.reduce((total, value) => total + value, 0)]];
      }),
    ) as AgentProviderReportedUsage;
    const totalTokens = values.reduce((total, usage) => total + (usage.totalTokens ?? usageTokenSum(usage)), 0);
    return {
      source: aggregateUsageSource(values),
      ...aggregate,
      totalTokens,
      estimatedFields: estimatedFields.length > 0 ? estimatedFields : undefined,
      calls: this.snapshot(),
    };
  }

  contextUsage(): AgentModelUsageValue | undefined {
    const selected = this.calls.reduce<AgentModelUsageCall | undefined>(
      (current, call) => (!current || usageContextSize(call.usage) > usageContextSize(current.usage) ? call : current),
      undefined,
    );
    return selected ? cloneUsageValue(selected.usage) : undefined;
  }

  snapshot(): AgentModelUsageCall[] {
    return this.calls.map((call) => ({
      stage: call.stage,
      usage: cloneUsageValue(call.usage),
    }));
  }
}

export function activeAgentModelUsageLedger(): AgentModelUsageLedger | undefined {
  return AgentModelUsageContext.getStore();
}

export function withAgentModelUsageLedger<T>(ledger: AgentModelUsageLedger, run: () => Promise<T>): Promise<T> {
  return AgentModelUsageContext.run(ledger, run);
}

export function recordActiveAgentModelUsage(call: AgentModelUsageCall): void {
  AgentModelUsageContext.getStore()?.record(call);
}

export function mergeProviderReportedUsage(
  current: AgentModelUsageValue | undefined,
  update: AgentModelUsageValue | undefined,
): AgentModelUsageValue | undefined {
  if (!update) return current;
  if (!current) return cloneUsageValue(update);
  return createProviderReportedUsage({
    inputTokens: update.inputTokens ?? current.inputTokens,
    outputTokens: update.outputTokens ?? current.outputTokens,
    totalTokens: update.totalTokens ?? current.totalTokens,
    cacheReadTokens: update.cacheReadTokens ?? current.cacheReadTokens,
    cacheWriteTokens: update.cacheWriteTokens ?? current.cacheWriteTokens,
    reasoningTokens: update.reasoningTokens ?? current.reasoningTokens,
  });
}

function resolveCompletedUsageSource(
  reported: AgentModelUsageValue | undefined,
  estimatedFieldCount: number,
): AgentModelUsageSource {
  if (!reported) return AgentModelUsageSources.LocalEstimate;
  return estimatedFieldCount === 0 ? AgentModelUsageSources.ProviderReported : AgentModelUsageSources.Mixed;
}

function aggregateUsageSource(values: readonly AgentModelUsageValue[]): AgentModelUsageSource {
  const sources = new Set(values.map((usage) => usage.source));
  if (sources.size === 1) return values[0]?.source ?? AgentModelUsageSources.Unavailable;
  return AgentModelUsageSources.Mixed;
}

function uniqueEstimatedFields(values: readonly AgentModelUsageValue[]): AgentModelUsageField[] {
  return [...new Set(values.flatMap((usage) => usage.estimatedFields ?? []))];
}

function cloneUsageValue(usage: AgentModelUsageValue): AgentModelUsageValue {
  return {
    ...usage,
    estimatedFields: usage.estimatedFields ? [...usage.estimatedFields] : undefined,
  };
}

function serializeModelInput(request: Pick<AgentLanguageModelRequest, "systemPrompt" | "messages">): string {
  return [request.systemPrompt, ...request.messages.map((message) => `${message.role}:\n${message.content}`)].join(
    "\n\n",
  );
}

function usageTokenSum(usage: AgentProviderReportedUsage): number {
  return sumPresentUsageFields(usage, ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"]);
}

function usageContextSize(usage: AgentModelUsageValue): number {
  return usage.totalTokens ?? usageTokenSum(usage);
}

function sumPresentUsageFields(usage: AgentProviderReportedUsage, fields: readonly AgentModelUsageField[]): number {
  return fields.reduce((total, field) => total + (usage[field] ?? 0), 0);
}

function normalizeTokenCount(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}
