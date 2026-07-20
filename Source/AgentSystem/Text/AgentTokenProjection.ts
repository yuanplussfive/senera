import { AgentModelTextPreviewer } from "./AgentTextBudget.js";

export interface AgentTokenTextPreview {
  text: string;
  tokenCount: number;
  tokenLimit: number;
  truncated: boolean;
  omittedTokens: number;
  measurement: "exact" | "estimated";
}

const ProjectionPreflightCharactersPerToken = 4;

export class AgentTokenProjector {
  private readonly previewers = new Map<number, AgentModelTextPreviewer>();

  constructor(private readonly model: string) {}

  previewText(value: string, tokenLimit: number): AgentTokenTextPreview {
    const limit = normalizeTokenLimit(tokenLimit);
    const preflight = preflightProjectionText(value, limit);
    const preview = this.previewer(limit).preview(preflight.text);
    const estimatedOmittedTokens = Math.ceil(preflight.omittedCharacters / ProjectionPreflightCharactersPerToken);
    return {
      text: preview.text,
      tokenCount: preview.tokenCount + estimatedOmittedTokens,
      tokenLimit: preview.tokenLimit,
      truncated: preflight.truncated || preview.truncated,
      omittedTokens: Math.max(0, preview.tokenCount + estimatedOmittedTokens - preview.tokenLimit),
      measurement: preflight.truncated ? "estimated" : "exact",
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
          tokenCountEstimated: preview.measurement === "estimated",
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

function preflightProjectionText(
  value: string,
  tokenLimit: number,
): { text: string; truncated: boolean; omittedCharacters: number } {
  const characterLimit = Math.max(1, tokenLimit * ProjectionPreflightCharactersPerToken);
  if (value.length <= characterLimit) {
    return { text: value, truncated: false, omittedCharacters: 0 };
  }
  return {
    text: `${value.slice(0, characterLimit).trimEnd()}...`,
    truncated: true,
    omittedCharacters: value.length - characterLimit,
  };
}

function normalizeTokenLimit(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}
