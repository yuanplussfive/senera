import type {
  AgentModelContextCategory,
  AgentModelContextSnapshot,
  AgentModelContextSection,
} from "../../../../Source/AgentSystem/Events/AgentModelContextSnapshot";
import type { FrontendFeatureMessageKey } from "../../i18n/frontendFeatureMessageCatalog";
import type { AppIconName } from "../../shared/ui/AppIcon";
import type { RunRecord, TimelineStep } from "../../store/sessionStore";
import { inspectionSteps } from "./inspectionScopeModel";

export const ContextCategoryPresentation = {
  system: { label: "insights.context.system", icon: "settings" },
  tools: { label: "insights.context.tools", icon: "code" },
  user: { label: "insights.context.user", icon: "user" },
  thinking: { label: "insights.context.thinking", icon: "thinking" },
  preface: { label: "insights.context.preface", icon: "message-square" },
  assistant: { label: "insights.context.assistant", icon: "message" },
  toolCall: { label: "insights.context.toolCall", icon: "terminal" },
  toolResult: { label: "insights.context.toolResult", icon: "output" },
} as const satisfies Record<AgentModelContextCategory, { label: FrontendFeatureMessageKey; icon: AppIconName }>;

export const ContextCategories = (Object.keys(ContextCategoryPresentation) as AgentModelContextCategory[]).map(
  (id) => ({
    id,
    ...ContextCategoryPresentation[id],
  }),
);

type ContextComposition = Array<(typeof ContextCategories)[number] & { tokens: number; count: number }>;
const Compositions = new WeakMap<AgentModelContextSnapshot, ContextComposition>();

export function contextComposition(snapshot: AgentModelContextSnapshot): ContextComposition {
  const cached = Compositions.get(snapshot);
  if (cached) return cached;
  const totals = new Map<AgentModelContextCategory, { tokens: number; count: number }>();
  for (const section of snapshot.sections) {
    const total = totals.get(section.category) ?? { tokens: 0, count: 0 };
    total.tokens += section.tokens;
    total.count++;
    totals.set(section.category, total);
  }
  const composition = ContextCategories.map((category) => ({
    ...category,
    tokens: totals.get(category.id)?.tokens ?? 0,
    count: totals.get(category.id)?.count ?? 0,
  }));
  Compositions.set(snapshot, composition);
  return composition;
}

interface ContextChanges {
  readonly added: Set<number>;
  readonly removed: number;
  readonly removedSections: readonly AgentModelContextSection[];
}
const Changes = new WeakMap<AgentModelContextSnapshot, WeakMap<AgentModelContextSnapshot, ContextChanges>>();

/** Compare content identities as a multiset: two identical messages still occupy two positions. */
export function contextChanges(current: AgentModelContextSnapshot, previous: AgentModelContextSnapshot | undefined) {
  if (!previous) return undefined;
  let comparisons = Changes.get(current);
  const cached = comparisons?.get(previous);
  if (cached) return cached;
  const remaining = new Map<string, number>();
  for (const section of previous.sections) remaining.set(section.id, (remaining.get(section.id) ?? 0) + 1);
  const added = new Set<number>();
  current.sections.forEach((section, index) => {
    const count = remaining.get(section.id) ?? 0;
    if (count === 0) added.add(index);
    else remaining.set(section.id, count - 1);
  });
  const removed = [...remaining.values()].reduce((sum, count) => sum + count, 0);
  const removedSections = previous.sections.filter((section) => {
    const count = remaining.get(section.id) ?? 0;
    if (count === 0) return false;
    remaining.set(section.id, count - 1);
    return true;
  });
  const changes = {
    added,
    removed,
    removedSections,
  };
  comparisons ??= new WeakMap();
  comparisons.set(previous, changes);
  Changes.set(current, comparisons);
  return changes;
}

export function modelRequests(run: RunRecord | undefined, scopeId?: string): TimelineStep[] {
  return inspectionSteps(run, scopeId).filter((step) => step.kind === "model");
}

export type RequestContextUsageSource = "provider" | "local_estimate";

export interface RequestContextUsage {
  readonly tokens: number;
  readonly source: RequestContextUsageSource;
}

/**
 * The provider's input and cache counters describe the billed request context.
 * A mixed usage record can still have a provider-reported input while another
 * field, such as output, was estimated locally.
 */
export function providerReportedRequestContextTokens(step: TimelineStep): number | undefined {
  const usage = step.modelUsage;
  if (
    !usage ||
    usage.inputTokens === undefined ||
    usage.source === "local_estimate" ||
    usage.source === "unavailable" ||
    usage.estimatedFields?.includes("inputTokens")
  ) {
    return undefined;
  }
  return usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}

/**
 * Every presentation surface uses the same request-size authority. The local
 * snapshot is retained for category composition, but never supersedes an
 * actual provider usage report.
 */
export function requestContextUsage(step: TimelineStep): RequestContextUsage | undefined {
  const providerTokens = providerReportedRequestContextTokens(step);
  if (providerTokens !== undefined) return { tokens: providerTokens, source: "provider" };
  const estimatedTokens = step.contextSnapshot?.estimatedTokens;
  return estimatedTokens === undefined ? undefined : { tokens: estimatedTokens, source: "local_estimate" };
}

/** Token deltas are comparable only when both requests use the same measuring authority. */
export function requestContextUsageDelta(
  current: TimelineStep,
  previous: TimelineStep | undefined,
): RequestContextUsage | undefined {
  const currentUsage = requestContextUsage(current);
  const previousUsage = previous ? requestContextUsage(previous) : undefined;
  if (!currentUsage || !previousUsage || currentUsage.source !== previousUsage.source) return undefined;
  return { source: currentUsage.source, tokens: currentUsage.tokens - previousUsage.tokens };
}
