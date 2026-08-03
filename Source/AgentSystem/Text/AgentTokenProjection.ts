import { AgentModelTextPreviewer } from "./AgentTextBudget.js";
import { AgentBudgetedJsonProjector, type AgentBudgetedJsonProjection } from "./AgentBudgetedJsonProjection.js";

export interface AgentTokenTextPreview {
  text: string;
  tokenCount: number;
  tokenLimit: number;
  truncated: boolean;
  omittedTokens: number;
  measurement: "exact" | "estimated";
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
      omittedTokens: Math.max(0, preview.tokenCount - preview.tokenLimit),
      measurement: "exact",
    };
  }

  previewJson(value: unknown, tokenLimit: number): unknown {
    return this.projectJson(value, tokenLimit).value;
  }

  projectJson(value: unknown, tokenLimit: number): AgentBudgetedJsonProjection {
    return this.jsonProjector.project(value, tokenLimit);
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
