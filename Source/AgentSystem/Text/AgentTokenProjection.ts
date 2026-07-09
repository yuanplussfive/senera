import { AgentModelTextPreviewer } from "./AgentTextBudget.js";

export interface AgentTokenTextPreview {
  text: string;
  tokenCount: number;
  tokenLimit: number;
  truncated: boolean;
  omittedTokens: number;
}

export class AgentTokenProjector {
  private readonly previewers = new Map<number, AgentModelTextPreviewer>();

  constructor(private readonly model: string) {}

  previewText(value: string, tokenLimit: number): AgentTokenTextPreview {
    const limit = normalizeTokenLimit(tokenLimit);
    const preview = this.previewer(limit).preview(value);
    return {
      text: preview.text,
      tokenCount: preview.tokenCount,
      tokenLimit: preview.tokenLimit,
      truncated: preview.truncated,
      omittedTokens: Math.max(0, preview.tokenCount - preview.tokenLimit),
    };
  }

  previewJson(value: unknown, tokenLimit: number): unknown {
    const json = JSON.stringify(value);
    if (!json) {
      return value;
    }
    const preview = this.previewText(json, tokenLimit);
    return preview.truncated
      ? {
          type: "senera.token_preview.v1",
          preview: preview.text,
          originalTokens: preview.tokenCount,
          omittedTokens: preview.omittedTokens,
          tokenLimit: preview.tokenLimit,
          truncated: true,
        }
      : value;
  }

  private previewer(tokenLimit: number): AgentModelTextPreviewer {
    const existing = this.previewers.get(tokenLimit);
    if (existing) {
      return existing;
    }

    const previewer = new AgentModelTextPreviewer({
      model: this.model,
      tokenLimit,
    });
    this.previewers.set(tokenLimit, previewer);
    return previewer;
  }
}

function normalizeTokenLimit(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}
