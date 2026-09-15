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

/**
 * Conservative bounds used to avoid exact BPE work for payloads that are
 * already too large to be useful as an unprojected model input.
 *
 * These are an early-projection policy, not a token-count estimate. A value
 * that crosses either bound is projected before exact tokenization; final
 * candidates are still measured exactly after projection.
 */
export const AgentTokenizationPreflight = {
  maxUtf16CodeUnitsPerToken: 4,
  maxUtf8BytesPerToken: 32,
  maxBoundedLeafUtf8BytesPerToken: 4,
  maxExactTokenizationSegmentCharacters: 4_096,
} as const;

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

export type AgentTokenLimitInspection =
  { readonly withinLimit: true; readonly tokenCount: number } | { readonly withinLimit: false };

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

  inspect(text: string, tokenLimit: number): AgentTokenLimitInspection {
    const normalizedLimit = normalizePositiveInteger(tokenLimit);
    if (shouldProjectBeforeExactTokenization(text, normalizedLimit)) {
      return { withinLimit: false };
    }
    const tokenCount = this.api.isWithinTokenLimit(text, normalizedLimit);
    return tokenCount === false ? { withinLimit: false } : { withinLimit: true, tokenCount };
  }
}

export function shouldProjectBeforeExactTokenization(text: string, tokenLimit: number): boolean {
  const normalizedLimit = normalizePositiveInteger(tokenLimit);
  return (
    text.length >= normalizedLimit * AgentTokenizationPreflight.maxUtf16CodeUnitsPerToken ||
    Buffer.byteLength(text, "utf8") >= normalizedLimit * AgentTokenizationPreflight.maxUtf8BytesPerToken
  );
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
    const bounded = boundTextForTokenization(text, this.context.tokenLimit);
    const tokens = this.api.encode(bounded.text);
    if (!bounded.wasBounded && tokens.length <= this.context.tokenLimit) {
      return {
        model: this.context.model,
        encodingName: this.context.encodingName,
        resolution: this.context.resolution,
        tokenLimit: this.context.tokenLimit,
        tokenCount: tokens.length,
        truncated: false,
        text,
      };
    }

    const markerTokens = this.api.encode(this.context.ellipsis);
    if (bounded.wasBounded) {
      const boundedCandidate = `${bounded.text.trimEnd()}${this.context.ellipsis}`;
      const boundedCandidateTokens = this.api.encode(boundedCandidate);
      if (boundedCandidateTokens.length <= this.context.tokenLimit) {
        return {
          model: this.context.model,
          encodingName: this.context.encodingName,
          resolution: this.context.resolution,
          tokenLimit: this.context.tokenLimit,
          tokenCount: boundedCandidateTokens.length,
          truncated: true,
          text: boundedCandidate,
        };
      }
    }
    let low = 0;
    let high = Math.min(tokens.length, Math.max(0, this.context.tokenLimit - markerTokens.length));
    let projected = this.context.ellipsis;
    let tokenCount = markerTokens.length;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = `${this.api.decode(tokens.slice(0, middle)).trimEnd()}${this.context.ellipsis}`;
      const candidateTokenCount = this.api.encode(candidate).length;
      if (candidateTokenCount <= this.context.tokenLimit) {
        projected = candidate;
        tokenCount = candidateTokenCount;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return {
      model: this.context.model,
      encodingName: this.context.encodingName,
      resolution: this.context.resolution,
      tokenLimit: this.context.tokenLimit,
      tokenCount,
      truncated: true,
      text: projected,
    };
  }
}

interface BoundedTextForTokenization {
  readonly text: string;
  readonly wasBounded: boolean;
}

function boundTextForTokenization(value: string, tokenLimit: number): BoundedTextForTokenization {
  if (!shouldProjectBeforeExactTokenization(value, tokenLimit)) {
    return { text: value, wasBounded: false };
  }
  const byteLimit = Math.max(64, tokenLimit * AgentTokenizationPreflight.maxBoundedLeafUtf8BytesPerToken);
  const boundedBytes = boundedUtf8Prefix(value, byteLimit);
  const bounded = boundedTokenizationPrefix(
    boundedBytes,
    AgentTokenizationPreflight.maxExactTokenizationSegmentCharacters,
  );
  return { text: bounded, wasBounded: bounded.length < value.length };
}

function boundedUtf8Prefix(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  let bytes = 0;
  let end = 0;
  while (end < value.length) {
    const codePoint = value.codePointAt(end);
    if (codePoint === undefined) break;
    const codePointLength = codePoint > 0xffff ? 2 : 1;
    const codePointBytes = utf8ByteLength(codePoint);
    if (bytes + codePointBytes > maxBytes) break;
    bytes += codePointBytes;
    end += codePointLength;
  }
  return end === value.length ? value : value.slice(0, end);
}

function boundedTokenizationPrefix(value: string, maximumSegmentCharacters: number): string {
  if (maximumSegmentCharacters <= 0) return "";
  let segmentCharacters = 0;
  let end = 0;
  while (end < value.length) {
    const codePoint = value.codePointAt(end);
    if (codePoint === undefined) break;
    const codePointLength = codePoint > 0xffff ? 2 : 1;
    if (isTokenizationBoundary(codePoint)) {
      segmentCharacters = 0;
    } else {
      segmentCharacters += 1;
      if (segmentCharacters >= maximumSegmentCharacters) {
        return value.slice(0, end + codePointLength);
      }
    }
    end += codePointLength;
  }
  return value;
}

function isTokenizationBoundary(codePoint: number): boolean {
  if (codePoint <= 0x20 || codePoint === 0x7f) return true;
  if (codePoint > 0x7f) return false;
  return !(
    (codePoint >= 0x30 && codePoint <= 0x39) ||
    (codePoint >= 0x41 && codePoint <= 0x5a) ||
    (codePoint >= 0x61 && codePoint <= 0x7a) ||
    codePoint === 0x5f
  );
}

function utf8ByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
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

function normalizePositiveInteger(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}
