import { Temporal } from "@js-temporal/polyfill";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { throwAbortReason } from "../Core/AgentCancellation.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { AgentBackgroundLearningRequestLedger } from "../Memory/AgentBackgroundLearningRequestLedger.js";
import type { AgentMemOSSemanticLearningPolicy } from "./AgentMemOSSemanticLearningRuntime.js";
import { AgentMemoryDiaryStore, type AgentMemoryDiaryMetadata } from "./AgentMemoryDiaryStore.js";
import { AgentMemoryDiaryModel, type AgentMemoryDiaryPrompt } from "./AgentMemoryDiaryModel.js";
import {
  AgentMemoryDiaryConfigSchema,
  agentMemoryDiaryDate,
  agentMemoryDiaryMonth,
  type AgentMemoryDiaryConfig,
  type AgentMemoryDiarySource,
} from "./AgentMemoryDiaryContract.js";

export interface AgentMemoryDiaryRuntimeOptions {
  readonly canonicalSubject?: (subject: string) => string;
  readonly store: AgentMemoryDiaryStore;
  readonly config: () => AgentMemoryDiaryConfig;
  readonly sources: () => Promise<readonly AgentMemoryDiarySource[]>;
  readonly model: () => ResolvedAgentModelProviderConfig;
  readonly scopeKey: string;
  readonly learningRequests: AgentBackgroundLearningRequestLedger;
  readonly withModelSlot: <T>(operation: () => Promise<T>) => Promise<T>;
  readonly policy: () => AgentMemOSSemanticLearningPolicy;
  readonly signal: AbortSignal;
  readonly now?: () => string;
}

/** Completed turns provide calendar coverage; generation writes Markdown files only. */
export class AgentMemoryDiaryRuntime {
  private epoch = 0;
  constructor(private readonly options: AgentMemoryDiaryRuntimeOptions) {}

  async reconcile(): Promise<void> {
    const epoch = this.epoch;
    const config = AgentMemoryDiaryConfigSchema.parse(this.options.config());
    const today = agentMemoryDiaryDate(this.options.now?.() ?? new Date().toISOString(), config.TimeZone);
    const sources = await this.options.sources();
    if (epoch !== this.epoch) return;
    if (!this.options.canonicalSubject) return this.reconcileStore(sources, this.options.store, config, today, epoch);
    const bySubject = new Map<string, AgentMemoryDiarySource[]>();
    for (const source of sources) {
      if (!source.subject) continue;
      const subject = this.options.canonicalSubject(source.subject);
      const records = bySubject.get(subject) ?? [];
      records.push({ ...source, subject });
      bySubject.set(subject, records);
    }
    const subjects = new Set([...bySubject.keys(), ...this.options.store.subjects()]);
    const failures: unknown[] = [];
    for (const subject of subjects) {
      try {
        await this.reconcileStore(
          bySubject.get(subject) ?? [],
          this.options.store.forSubject(subject),
          config,
          today,
          epoch,
        );
      } catch (error) {
        throwAbortReason(this.options.signal);
        failures.push(error);
      }
      if (epoch !== this.epoch) return;
    }
    if (failures.length) throw new AggregateError(failures, "Some subject diaries could not be generated.");
  }

  private async reconcileStore(
    sources: readonly AgentMemoryDiarySource[],
    store: AgentMemoryDiaryStore,
    config: AgentMemoryDiaryConfig,
    today: string,
    epoch: number,
  ): Promise<void> {
    const groups = new Map<string, AgentMemoryDiarySource[]>();
    for (const source of sources) {
      const date = agentMemoryDiaryDate(source.occurredAt, config.TimeZone);
      if (date >= today) continue;
      const group = groups.get(date) ?? [];
      group.push(source);
      groups.set(date, group);
    }
    const model = this.options.model();
    const client = new AgentMemoryDiaryModel(model, this.options.scopeKey);
    const modelRevision = client.revision;
    const sharedConfig = { InputTokenBudget: config.InputTokenBudget, TimeZone: config.TimeZone };
    const dailyConfig = { ...sharedConfig, TurnPreviewTokens: config.TurnPreviewTokens };
    const monthlyConfig = { ...sharedConfig, MonthlyPreviewTokens: config.MonthlyPreviewTokens };
    const failures: unknown[] = [];
    const failedMonths = new Set<string>();
    const dates = new Set([...groups.keys(), ...store.list({ period: "day", to: today }).map((entry) => entry.key)]);
    for (const date of [...dates].sort()) {
      if (date >= today) continue;
      const records = groups.get(date) ?? [];
      const existing = store.read(date);
      if (!records.length) {
        if (!existing?.metadata?.importedFrom) store.remove(date);
        continue;
      }
      const revision = sha256HexOfCanonicalJson({
        version: 2,
        records: [...records].sort((a, b) => a.id.localeCompare(b.id)),
        config: dailyConfig,
        modelRevision,
      });
      if (existing?.metadata?.revision === revision) continue;
      try {
        const prompt = client.daily(date, records, config);
        await this.generate(store, client, model, prompt, {
          revision,
          episodeUris: unique(records.flatMap((entry) => entry.episodeUris)),
          sourceUris: unique(records.flatMap((entry) => entry.sourceUris)),
        });
      } catch (error) {
        throwAbortReason(this.options.signal);
        failures.push(error);
        failedMonths.add(agentMemoryDiaryMonth(date));
      }
      if (epoch !== this.epoch) return;
    }
    const currentMonth = agentMemoryDiaryMonth(today);
    const days = store.list({ period: "day" });
    const months = new Set([
      ...days.map((entry) => agentMemoryDiaryMonth(entry.key)),
      ...store.list({ period: "month" }).map((entry) => entry.key),
    ]);
    for (const month of [...months].filter((key) => key < currentMonth).sort()) {
      if (failedMonths.has(month)) continue;
      const entries = days
        .filter((entry) => agentMemoryDiaryMonth(entry.key) === month)
        .map((entry) => store.read(entry.key)!);
      if (!entries.length) {
        if (!store.read(month)?.metadata?.importedFrom) store.remove(month);
        continue;
      }
      const revision = sha256HexOfCanonicalJson({
        version: 1,
        entries: entries.map(({ key, title, body }) => ({ key, title, body })),
        config: monthlyConfig,
        modelRevision,
      });
      if (store.read(month)?.metadata?.revision === revision) continue;
      try {
        const prompt = client.monthly(month, entries, config);
        await this.generate(store, client, model, prompt, {
          revision,
          episodeUris: unique(entries.flatMap((entry) => entry.metadata?.episodeUris ?? [])),
          sourceUris: unique(entries.flatMap((entry) => entry.metadata?.sourceUris ?? [])),
        });
      } catch (error) {
        throwAbortReason(this.options.signal);
        failures.push(error);
      }
      if (epoch !== this.epoch) return;
    }
    store.writeIndex(today, config.RecentDays);
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, "Some diary periods could not be generated.");
  }

  invalidateSources(episodeUris: readonly string[], sourceUris: readonly string[]): void {
    this.epoch += 1;
    for (const subject of this.options.store.subjects()) {
      const store = this.options.store.forSubject(subject);
      store.invalidateSources(new Set(episodeUris), new Set(sourceUris));
      const config = this.options.config();
      store.writeIndex(
        agentMemoryDiaryDate(this.options.now?.() ?? new Date().toISOString(), config.TimeZone),
        config.RecentDays,
      );
    }
    this.options.store.invalidateSources(new Set(episodeUris), new Set(sourceUris));
    const config = this.options.config();
    this.options.store.writeIndex(
      agentMemoryDiaryDate(this.options.now?.() ?? new Date().toISOString(), config.TimeZone),
      config.RecentDays,
    );
  }

  nextBoundaryDelay(now = Temporal.Now.instant()): number {
    const local = now.toZonedDateTimeISO(this.options.config().TimeZone);
    return Number(local.add({ days: 1 }).startOfDay().epochMilliseconds - now.epochMilliseconds);
  }

  private async generate(
    store: AgentMemoryDiaryStore,
    client: AgentMemoryDiaryModel,
    model: ResolvedAgentModelProviderConfig,
    prompt: AgentMemoryDiaryPrompt,
    metadata: AgentMemoryDiaryMetadata,
  ): Promise<void> {
    throwAbortReason(this.options.signal);
    const existing = store.read(prompt.key);
    if (existing?.metadata?.revision === metadata.revision) return;
    const epoch = this.epoch;
    await this.options.learningRequests.runRetried(
      {
        operationKey: `diary:${sha256HexOfCanonicalJson(store.root)}:${prompt.key}`,
        board: "semantic_memory",
        stage: prompt.period === "day" ? "daily_diary" : "monthly_diary",
        entityUri: store.pathFor(prompt.key),
        sourceRevision: metadata.revision,
        providerId: model.Id,
        model: model.Model,
        metadata: {
          period: prompt.period,
          key: prompt.key,
          episodeUris: metadata.episodeUris,
          sourceUris: metadata.sourceUris,
        },
      },
      this.options.policy(),
      () =>
        this.options.withModelSlot(async () => {
          throwAbortReason(this.options.signal);
          if (epoch !== this.epoch) return;
          const document = await client.generate(
            prompt,
            `diary:${prompt.key}:${metadata.revision}`,
            this.options.signal,
          );
          throwAbortReason(this.options.signal);
          if (epoch !== this.epoch) return;
          store.write(prompt.key, document, metadata);
        }),
      undefined,
      this.options.signal,
    );
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
