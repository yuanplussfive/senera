import { createRequire } from "node:module";

type EncodingApi = {
  encode(input: string): number[];
  decode(tokens: Iterable<number>): string;
  countTokens(input: string): number;
  isWithinTokenLimit(input: string, tokenLimit: number): false | number;
};

type EncodingName = "cl100k_base" | "o200k_base" | "o200k_harmony" | "p50k_base" | "p50k_edit" | "r50k_base";

interface TokenizerMappingModule {
  DEFAULT_ENCODING: EncodingName;
  modelToEncodingMap: Record<string, EncodingName>;
}

const nodeRequire = createRequire(import.meta.url);
const tokenizerMapping = nodeRequire("gpt-tokenizer/cjs/mapping") as TokenizerMappingModule;

const EncodingApiRegistry = {
  cl100k_base: nodeRequire("gpt-tokenizer/cjs/encoding/cl100k_base") as EncodingApi,
  o200k_base: nodeRequire("gpt-tokenizer/cjs/encoding/o200k_base") as EncodingApi,
  o200k_harmony: nodeRequire("gpt-tokenizer/cjs/encoding/o200k_harmony") as EncodingApi,
  p50k_base: nodeRequire("gpt-tokenizer/cjs/encoding/p50k_base") as EncodingApi,
  p50k_edit: nodeRequire("gpt-tokenizer/cjs/encoding/p50k_edit") as EncodingApi,
  r50k_base: nodeRequire("gpt-tokenizer/cjs/encoding/r50k_base") as EncodingApi,
} as const satisfies Record<EncodingName, EncodingApi>;

const KnownModelEncodingMap = tokenizerMapping.modelToEncodingMap;

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

export type AgentExceededTextBudgetSnapshot = Extract<AgentTextBudgetSnapshot, { state: "limit_reached" }>;

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
  const encodingName = KnownModelEncodingMap[model] ?? tokenizerMapping.DEFAULT_ENCODING;
  return {
    api: EncodingApiRegistry[encodingName],
    model,
    encodingName,
    resolution: Object.prototype.hasOwnProperty.call(KnownModelEncodingMap, model) ? "model_map" : "default_encoding",
  };
}
