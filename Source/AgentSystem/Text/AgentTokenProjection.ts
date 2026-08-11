import { AgentModelTextPreviewer } from "./AgentTextBudget.js";
import { AgentBudgetedJsonProjector, type AgentBudgetedJsonProjection } from "./AgentBudgetedJsonProjection.js";

export interface AgentTokenTextPreview {
  text: string;
  tokenCount: number;
  tokenLimit: number;
  truncated: boolean;
}

export interface AgentJsonMemberProjection {
  readonly value: Record<string, unknown>;
  readonly complete: boolean;
}

export class AgentTokenProjector {
  private readonly jsonProjector: AgentBudgetedJsonProjector;

  constructor(private readonly model: string) {
    this.jsonProjector = new AgentBudgetedJsonProjector(model);
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
