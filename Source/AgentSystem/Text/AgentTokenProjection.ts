import { AgentModelTextPreviewer, AgentModelTokenEstimator } from "./AgentTextBudget.js";
import { AgentBudgetedJsonProjector, type AgentBudgetedJsonProjection } from "./AgentBudgetedJsonProjection.js";

export interface AgentTokenTextPreview {
  text: string;
  tokenCount: number;
  tokenLimit: number;
  truncated: boolean;
}

export interface AgentTokenTextProjection extends AgentTokenTextPreview {
  readonly complete: boolean;
  readonly omittedUnits: number;
}

export interface AgentJsonMemberProjection {
  readonly value: Record<string, unknown>;
  readonly complete: boolean;
}

export class AgentTokenProjector {
  private readonly jsonProjector: AgentBudgetedJsonProjector;
  private readonly estimator: AgentModelTokenEstimator;

  constructor(private readonly model: string) {
    this.jsonProjector = new AgentBudgetedJsonProjector(model);
    this.estimator = new AgentModelTokenEstimator({ model });
  }

  previewText(value: string, tokenLimit: number): AgentTokenTextPreview {
    const limit = normalizeTokenLimit(tokenLimit);
    const preview = new AgentModelTextPreviewer({ model: this.model, tokenLimit: limit }).preview(value);
    return {
      text: preview.text,
      tokenCount: preview.tokenCount,
      tokenLimit: preview.tokenLimit,
      truncated: preview.truncated,
    };
  }

  /**
   * Fits model-produced text to a token budget without treating the budget
   * violation as a structured-output failure. Complete paragraphs/sentences
   * are retained in source order; the tokenizer remains the final authority.
   */
  projectText(value: string, tokenLimit: number): AgentTokenTextProjection {
    const limit = normalizeTokenLimit(tokenLimit);
    const source = value.trim();
    const sourceInspection = this.estimator.inspect(source, limit);
    if (sourceInspection.withinLimit) {
      const sourceTokens = sourceInspection.tokenCount;
      return {
        text: source,
        tokenCount: sourceTokens,
        tokenLimit: limit,
        truncated: false,
        complete: true,
        omittedUnits: 0,
      };
    }

    const units = splitTextUnits(source);
    const marker = "...";
    const markerTokens = this.estimator.estimate(marker).tokenCount;
    const canUseMarker = markerTokens < limit;
    const selected: Array<{ readonly index: number; readonly text: string }> = [];
    const selectedIndexes = new Set<number>();
    const add = (index: number): void => {
      const unit = units[index];
      if (!unit || selectedIndexes.has(index)) return;
      const candidate = [...selected, { index, text: unit }]
        .sort((left, right) => left.index - right.index)
        .map((entry) => entry.text)
        .join("\n\n");
      const candidateWithMarker = canUseMarker ? `${candidate}\n\n${marker}` : candidate;
      if (!this.estimator.inspect(candidateWithMarker, limit).withinLimit) return;
      selected.push({ index, text: unit });
      selectedIndexes.add(index);
    };

    add(0);
    if (units.length > 1) add(units.length - 1);
    for (let index = 1; index < units.length - 1; index += 1) add(index);

    let projected = selected
      .sort((left, right) => left.index - right.index)
      .map((entry) => entry.text)
      .join("\n\n");
    if (selected.length < units.length && canUseMarker && projected) projected = `${projected}\n\n${marker}`;
    let measurement = this.estimator.estimate(projected).tokenCount;
    if (!projected || measurement > limit) {
      const preview = new AgentModelTextPreviewer({
        model: this.model,
        tokenLimit: limit,
        ellipsis: canUseMarker ? marker : "",
      }).preview(source);
      projected = preview.text;
      measurement = preview.tokenCount;
    }
    if (measurement > limit) {
      throw new Error(`Text projection cannot fit the requested token budget: ${limit}.`);
    }
    return {
      text: projected,
      tokenCount: measurement,
      tokenLimit: limit,
      truncated: true,
      complete: selected.length >= units.length,
      omittedUnits: Math.max(0, units.length - selected.length),
    };
  }

  projectJson(value: unknown, tokenLimit: number): AgentBudgetedJsonProjection {
    return this.jsonProjector.project(value, tokenLimit);
  }

  projectJsonMember(
    envelope: Readonly<Record<string, unknown>>,
    member: string,
    value: unknown,
    tokenLimit: number,
  ): AgentJsonMemberProjection {
    const limit = normalizeTokenLimit(tokenLimit);
    const emptyValue = { ...envelope, [member]: {} };
    if (!this.fitsJson(emptyValue, limit)) {
      throw new Error(`JSON envelope exceeds the requested token budget: ${limit}.`);
    }

    let lower = 1;
    let upper = limit;
    let bestValue = emptyValue;
    let bestComplete = false;

    while (lower <= upper) {
      const candidateLimit = Math.floor((lower + upper) / 2);
      const projection = this.projectJson(value, candidateLimit);
      const candidate = { ...envelope, [member]: projection.projectedValue };
      if (this.fitsJson(candidate, limit)) {
        bestValue = candidate;
        bestComplete = projection.complete;
        lower = candidateLimit + 1;
      } else {
        upper = candidateLimit - 1;
      }
    }

    return { value: bestValue, complete: bestComplete };
  }

  fitsJson(value: unknown, tokenLimit: number): boolean {
    return this.jsonProjector.fits(value, tokenLimit);
  }

  countJson(value: unknown): number {
    return this.jsonProjector.count(value);
  }
}

function normalizeTokenLimit(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

const sentenceSegmenter = new Intl.Segmenter("und", { granularity: "sentence" });

function splitTextUnits(value: string): readonly string[] {
  return value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split(/\n{2,}/u)
    .flatMap((block) => {
      const trimmed = block.trim();
      if (!trimmed) return [];
      const sentences = [...sentenceSegmenter.segment(trimmed)].map((entry) => entry.segment.trim()).filter(Boolean);
      return sentences.length > 0 ? sentences : [trimmed];
    });
}
