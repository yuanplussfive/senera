import { countTokens } from "gpt-tokenizer";
import type { ModelProviderMetadata, ModelUsageMetadata } from "../../api/eventTypes";
import { frontendMessage, type FrontendMessageKey } from "../../i18n/frontendMessageCatalog";
import { getFrontendLocale } from "../../i18n/frontendLocaleStore";
import { cn, formatInteger } from "../../lib/util";
import type { RunRecord, TimelineStep } from "../../store/sessionStore";
import { AppIcon, Tooltip } from "../../shared/ui";

type MessageMetricsRole = "user" | "assistant";

export interface MessageMetricsProps {
  role: MessageMetricsRole;
  text?: string;
  usage?: ModelUsageMetadata;
  run?: RunRecord;
  modelProvider?: ModelProviderMetadata;
  align?: "left" | "right";
}

const usageFieldLabels = {
  inputTokens: "chat.metrics.inputTokens",
  outputTokens: "chat.metrics.outputTokens",
  totalTokens: "chat.metrics.totalTokens",
  cacheReadTokens: "chat.metrics.cacheRead",
  cacheWriteTokens: "chat.metrics.cacheWrite",
  reasoningTokens: "chat.metrics.reasoning",
} as const satisfies Record<
  "inputTokens" | "outputTokens" | "totalTokens" | "cacheReadTokens" | "cacheWriteTokens" | "reasoningTokens",
  FrontendMessageKey
>;

const usageFieldNames = {
  inputTokens: "chat.metrics.field.inputTokens",
  outputTokens: "chat.metrics.field.outputTokens",
  totalTokens: "chat.metrics.field.totalTokens",
  cacheReadTokens: "chat.metrics.field.cacheReadTokens",
  cacheWriteTokens: "chat.metrics.field.cacheWriteTokens",
  reasoningTokens: "chat.metrics.field.reasoningTokens",
} as const satisfies Record<keyof typeof usageFieldLabels, FrontendMessageKey>;

const sourceLabels = {
  provider_reported: "chat.metrics.source.provider",
  mixed: "chat.metrics.source.mixed",
  local_estimate: "chat.metrics.source.localEstimate",
  unavailable: "chat.metrics.source.unavailable",
} as const satisfies Record<ModelUsageMetadata["source"], FrontendMessageKey>;

const usageFields = Object.keys(usageFieldLabels) as Array<keyof typeof usageFieldLabels>;

export function MessageMetrics({
  role,
  text,
  usage,
  run,
  modelProvider,
  align = role === "user" ? "right" : "left",
}: MessageMetricsProps) {
  const userTokens = role === "user" ? readUserMessageTokens(text) : undefined;
  const localUserUsage: ModelUsageMetadata | undefined =
    role === "user" && userTokens !== undefined
      ? {
          source: "local_estimate",
          inputTokens: userTokens,
          estimatedFields: ["inputTokens"],
        }
      : undefined;
  const shouldReserveSlot =
    role === "user"
      ? userTokens !== undefined
      : usage !== undefined && (run === undefined || run.status === "completed");

  if (!shouldReserveSlot) return null;
  const modelName = role === "assistant" ? readModelName(modelProvider, run) : undefined;
  const providerName = role === "assistant" ? readProviderName(modelProvider) : undefined;
  const modelDurationMs = role === "assistant" ? readModelDurationMs(run) : undefined;
  const throughput =
    role === "assistant" && usage?.outputTokens !== undefined && modelDurationMs !== undefined
      ? readThroughput(usage.outputTokens, modelDurationMs)
      : undefined;
  const totalTokens = role === "assistant" ? usage?.totalTokens : undefined;

  if (role === "assistant" && totalTokens === undefined && throughput === undefined) return null;

  return (
    <div
      className={cn(
        "message-metrics flex min-w-0 flex-wrap items-center gap-x-[0.8em] gap-y-[0.15em] tabular-nums leading-[1.25] text-content-muted",
        role === "user" ? "message-metrics--user" : "message-metrics--assistant",
        align === "right" ? "justify-end" : "justify-start",
      )}
      data-message-metrics
      data-message-metrics-role={role}
    >
      {role === "assistant" && (totalTokens !== undefined || throughput !== undefined) ? (
        <Tooltip
          side="top"
          align={align === "right" ? "end" : "start"}
          content={usage ? <UsageDetails usage={usage} modelName={modelName} providerName={providerName} /> : null}
        >
          <span
            className="inline-flex min-w-0 items-center gap-[0.8em] rounded-md px-[0.35em] py-[0.2em] text-content-muted outline-none transition-colors hover:bg-surface-muted hover:text-content-primary focus-visible:bg-surface-muted focus-visible:text-content-primary"
            tabIndex={0}
            aria-label={readAssistantMetricsLabel(totalTokens, throughput)}
            data-message-metrics-usage
          >
            {totalTokens !== undefined ? (
              <span className="inline-flex min-w-0 items-center gap-[0.35em]" data-message-metrics-total>
                <AppIcon icon="stack" size="1em" strokeWidth={1.65} />
                <span className="whitespace-nowrap">{readCompactTokenLabel(totalTokens)}</span>
              </span>
            ) : null}
            {throughput !== undefined ? (
              <span className="inline-flex min-w-0 items-center gap-[0.35em]" data-message-metrics-throughput>
                <AppIcon icon="gauge" size="1.25em" strokeWidth={1.65} />
                <span className="whitespace-nowrap">
                  {frontendMessage("chat.metrics.throughputCompact", { rate: formatRate(throughput) })}
                </span>
              </span>
            ) : null}
          </span>
        </Tooltip>
      ) : null}

      {role === "user" && userTokens !== undefined ? (
        <Tooltip
          side="top"
          align={align === "right" ? "end" : "start"}
          content={localUserUsage ? <UsageDetails usage={localUserUsage} /> : null}
        >
          <span
            className="inline-flex min-w-0 items-center gap-[0.35em] rounded-md px-[0.35em] py-[0.2em] text-content-muted outline-none transition-colors hover:bg-surface-muted hover:text-content-primary focus-visible:bg-surface-muted focus-visible:text-content-primary"
            tabIndex={0}
            aria-label={readTokenLabel(userTokens)}
            data-message-metrics-usage
          >
            <AppIcon icon="input" size="1em" strokeWidth={1.65} />
            <span className="whitespace-nowrap">{readTokenLabel(userTokens)}</span>
          </span>
        </Tooltip>
      ) : null}
    </div>
  );
}

function readUserMessageTokens(text?: string): number | undefined {
  return text === undefined ? undefined : countTokens(text);
}

function readModelName(provider?: ModelProviderMetadata, run?: RunRecord): string | undefined {
  const providerName = provider?.model.trim();
  if (providerName) return providerName;
  return [...(run?.steps ?? [])]
    .reverse()
    .find((step) => step.kind === "model" && step.modelName?.trim())
    ?.modelName?.trim();
}

function readProviderName(provider?: ModelProviderMetadata): string | undefined {
  const name = provider?.providerId?.trim();
  return name || undefined;
}

function readModelDurationMs(run?: RunRecord): number | undefined {
  if (!run) return undefined;
  const duration = run.steps
    .filter((step) => step.kind === "model")
    .map(readStepDurationMs)
    .filter((value): value is number => value !== undefined)
    .reduce((total, value) => total + value, 0);
  return duration > 0 ? duration : undefined;
}

function readStepDurationMs(step: TimelineStep): number | undefined {
  if (typeof step.durationMs === "number" && Number.isFinite(step.durationMs) && step.durationMs > 0) {
    return step.durationMs;
  }
  const startedAt = Date.parse(step.startedAt);
  const endedAt = step.endedAt ? Date.parse(step.endedAt) : Number.NaN;
  return Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt > startedAt
    ? endedAt - startedAt
    : undefined;
}

function readThroughput(outputTokens: number, durationMs: number): number | undefined {
  if (!Number.isFinite(outputTokens) || outputTokens < 0 || !Number.isFinite(durationMs) || durationMs <= 0) {
    return undefined;
  }
  const value = (outputTokens * 1000) / durationMs;
  return Number.isFinite(value) ? value : undefined;
}

function formatRate(value: number): string {
  return new Intl.NumberFormat(getFrontendLocale(), {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value);
}

function readAssistantMetricsLabel(totalTokens?: number, throughput?: number): string {
  return [
    totalTokens === undefined ? undefined : readCompactTokenLabel(totalTokens),
    throughput === undefined
      ? undefined
      : frontendMessage("chat.metrics.throughputCompact", { rate: formatRate(throughput) }),
  ]
    .filter((value): value is string => value !== undefined)
    .join(", ");
}

function UsageDetails({
  usage,
  modelName,
  providerName,
}: {
  usage: ModelUsageMetadata;
  modelName?: string;
  providerName?: string;
}): JSX.Element {
  const rows = usageFields.flatMap((field) => {
    const value = usage[field];
    return typeof value === "number" && Number.isFinite(value)
      ? [frontendMessage(usageFieldLabels[field], { count: formatInteger(value) })]
      : [];
  });
  const estimated = usage.estimatedFields?.map((field) => frontendMessage(usageFieldNames[field])).join(", ");
  const source = frontendMessage(sourceLabels[usage.source]);

  return (
    <span className="flex max-w-[min(24rem,calc(100vw-2rem))] flex-col gap-0.5">
      {providerName ? (
        <span data-message-metrics-provider>
          {frontendMessage("chat.metrics.provider", { provider: providerName })}
        </span>
      ) : null}
      {modelName ? (
        <span data-message-metrics-model>{frontendMessage("chat.metrics.model", { model: modelName })}</span>
      ) : null}
      {rows.map((row) => (
        <span key={row}>{row}</span>
      ))}
      {!providerName ? <span>{frontendMessage("chat.metrics.source", { source })}</span> : null}
      {estimated ? <span>{frontendMessage("chat.metrics.estimated", { fields: estimated })}</span> : null}
    </span>
  );
}

function readTokenLabel(value: number): string {
  return frontendMessage("chat.metrics.tokens", { count: formatInteger(value) });
}

function readCompactTokenLabel(value: number): string {
  return frontendMessage("chat.metrics.tokens", { count: formatCompactTokenCount(value) });
}

function formatCompactTokenCount(value: number): string {
  const normalized = Math.max(0, Number.isFinite(value) ? value : 0);
  const isChinese = getFrontendLocale().toLowerCase().startsWith("zh");
  const unit = isChinese
    ? normalized >= 10_000
      ? { divisor: 10_000, suffix: "w" }
      : normalized >= 1_000
        ? { divisor: 1_000, suffix: "k" }
        : { divisor: 1, suffix: "" }
    : normalized >= 1_000_000
      ? { divisor: 1_000_000, suffix: "m" }
      : normalized >= 1_000
        ? { divisor: 1_000, suffix: "k" }
        : { divisor: 1, suffix: "" };

  return `${trimCompactNumber(normalized / unit.divisor)}${unit.suffix}`;
}

function trimCompactNumber(value: number): string {
  return value.toFixed(2).replace(/\.?(?:0+)$/u, "");
}
