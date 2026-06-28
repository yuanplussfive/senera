import * as cl100kBase from "gpt-tokenizer/cjs/encoding/cl100k_base";
import * as o200kBase from "gpt-tokenizer/cjs/encoding/o200k_base";
import * as o200kHarmony from "gpt-tokenizer/cjs/encoding/o200k_harmony";
import * as p50kBase from "gpt-tokenizer/cjs/encoding/p50k_base";
import * as p50kEdit from "gpt-tokenizer/cjs/encoding/p50k_edit";
import * as r50kBase from "gpt-tokenizer/cjs/encoding/r50k_base";
import {
  DEFAULT_ENCODING,
  modelToEncodingMap,
  type EncodingName,
} from "gpt-tokenizer/cjs/mapping";

type EncodingApi = {
  encode(input: string): number[];
  decode(tokens: Iterable<number>): string;
  countTokens(input: string): number;
  isWithinTokenLimit(input: string, tokenLimit: number): false | number;
};

const EncodingApiRegistry = {
  cl100k_base: cl100kBase,
  o200k_base: o200kBase,
  o200k_harmony: o200kHarmony,
  p50k_base: p50kBase,
  p50k_edit: p50kEdit,
  r50k_base: r50kBase,
} as const satisfies Record<EncodingName, EncodingApi>;

const KnownModelEncodingMap = modelToEncodingMap as Record<string, EncodingName>;

export type AgentTextBudgetSnapshot =
  | {
      state: "within_budget";
      model: string;
      encodingName: EncodingName;
      resolution: "model_map" | "default_encoding";
      tokenLimit: number;
      tokenCount: number;
      remainingTokens: number;
    }
  | {
      state: "limit_reached";
      model: string;
      encodingName: EncodingName;
      resolution: "model_map" | "default_encoding";
      tokenLimit: number;
      tokenCount: number;
      exceededTokens: number;
    };

export type AgentExceededTextBudgetSnapshot = Extract<
  AgentTextBudgetSnapshot,
  { state: "limit_reached" }
>;

export interface AgentTextBudgetEvaluator {
  measure(text: string): AgentTextBudgetSnapshot;
}

export interface AgentModelTextBudgetOptions {
  model: string;
  tokenLimit: number;
}

export interface AgentModelTextPreviewOptions {
  model: string;
  tokenLimit: number;
  ellipsis?: string;
}

export interface AgentModelTextPreviewSnapshot {
  model: string;
  encodingName: EncodingName;
  resolution: "model_map" | "default_encoding";
  tokenLimit: number;
  tokenCount: number;
  truncated: boolean;
  text: string;
}

interface ResolvedEncodingContext {
  api: EncodingApi;
  model: string;
  encodingName: EncodingName;
  resolution: "model_map" | "default_encoding";
}

export class AgentModelTextBudget implements AgentTextBudgetEvaluator {
  private readonly api: EncodingApi;
  private readonly context: {
    model: string;
    encodingName: EncodingName;
    resolution: "model_map" | "default_encoding";
    tokenLimit: number;
  };

  constructor(options: AgentModelTextBudgetOptions) {
    const context = resolveEncodingContext(options.model);
    this.api = context.api;
    this.context = {
      model: context.model,
      encodingName: context.encodingName,
      resolution: context.resolution,
      tokenLimit: options.tokenLimit,
    };
  }

  measure(text: string): AgentTextBudgetSnapshot {
    const measurement = this.api.isWithinTokenLimit(text, this.context.tokenLimit);
    return measurement === false
      ? this.limitReached(text)
      : {
          ...this.context,
          state: "within_budget",
          tokenCount: measurement,
          remainingTokens: Math.max(0, this.context.tokenLimit - measurement),
        };
  }

  private limitReached(text: string): AgentExceededTextBudgetSnapshot {
    const tokenCount = this.api.countTokens(text);
    return {
      ...this.context,
      state: "limit_reached",
      tokenCount,
      exceededTokens: Math.max(0, tokenCount - this.context.tokenLimit),
    };
  }
}

export interface AgentTokenEstimate {
  model: string;
  encodingName: EncodingName;
  resolution: "model_map" | "default_encoding";
  tokenCount: number;
}

export class AgentModelTokenEstimator {
  private readonly api: EncodingApi;
  private readonly context: {
    model: string;
    encodingName: EncodingName;
    resolution: "model_map" | "default_encoding";
  };

  constructor(options: { model: string }) {
    const context = resolveEncodingContext(options.model);
    this.api = context.api;
    this.context = {
      model: context.model,
      encodingName: context.encodingName,
      resolution: context.resolution,
    };
  }

  estimate(text: string): AgentTokenEstimate {
    return {
      ...this.context,
      tokenCount: this.api.countTokens(text),
    };
  }
}

export class AgentModelTextPreviewer {
  private readonly api: EncodingApi;
  private readonly context: {
    model: string;
    encodingName: EncodingName;
    resolution: "model_map" | "default_encoding";
    tokenLimit: number;
    ellipsis: string;
  };

  constructor(options: AgentModelTextPreviewOptions) {
    const context = resolveEncodingContext(options.model);
    this.api = context.api;
    this.context = {
      model: context.model,
      encodingName: context.encodingName,
      resolution: context.resolution,
      tokenLimit: options.tokenLimit,
      ellipsis: options.ellipsis ?? "...",
    };
  }

  preview(text: string): AgentModelTextPreviewSnapshot {
    const tokens = this.api.encode(text);
    return tokens.length <= this.context.tokenLimit
      ? {
          model: this.context.model,
          encodingName: this.context.encodingName,
          resolution: this.context.resolution,
          tokenLimit: this.context.tokenLimit,
          tokenCount: tokens.length,
          truncated: false,
          text,
        }
      : {
          model: this.context.model,
          encodingName: this.context.encodingName,
          resolution: this.context.resolution,
          tokenLimit: this.context.tokenLimit,
          tokenCount: tokens.length,
          truncated: true,
          text: `${this.api.decode(tokens.slice(0, this.context.tokenLimit)).trimEnd()}${this.context.ellipsis}`,
        };
  }
}

function resolveEncodingContext(model: string): ResolvedEncodingContext {
  const encodingName = KnownModelEncodingMap[model] ?? DEFAULT_ENCODING;
  return {
    api: EncodingApiRegistry[encodingName],
    model,
    encodingName,
    resolution: Object.prototype.hasOwnProperty.call(KnownModelEncodingMap, model)
      ? "model_map"
      : "default_encoding",
  };
}
