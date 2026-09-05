import type { AgentModelTokenEstimator } from "./AgentTextBudget.js";

/**
 * Provider-neutral reservation for one visual input.
 *
 * Image bytes are transport data, not language-model text. Pi uses the same
 * conservative reservation when it estimates mixed text/image context, so the
 * host budget follows that contract instead of counting base64 characters as
 * ordinary text tokens.
 */
export const AgentMultimodalTokenPolicy = {
  imageTokenReservation: 1_200,
} as const;

const ImageDataPlaceholder = "[image data omitted from text token accounting]";

export interface AgentModelInputTokenInspection {
  readonly withinLimit: boolean;
  readonly tokenCount?: number;
}

/**
 * Estimates JSON payloads while treating inline images as visual inputs.
 *
 * The returned text is only an accounting projection. It must never be sent
 * to a provider because image data is intentionally replaced by a marker.
 */
export function estimateAgentModelInputTokens(
  estimator: Pick<AgentModelTokenEstimator, "estimate">,
  payload: unknown,
): number {
  const projection = projectAgentModelInputForTokenBudget(payload);
  const textTokens = projection.text.length > 0 ? estimator.estimate(projection.text).tokenCount : 0;
  return textTokens + projection.imageCount * AgentMultimodalTokenPolicy.imageTokenReservation;
}

export function inspectAgentModelInputTokens(
  estimator: Pick<AgentModelTokenEstimator, "inspect">,
  payload: unknown,
  tokenLimit: number,
): AgentModelInputTokenInspection {
  const projection = projectAgentModelInputForTokenBudget(payload);
  const imageTokens = projection.imageCount * AgentMultimodalTokenPolicy.imageTokenReservation;
  const remainingTextTokens = Math.floor(tokenLimit) - imageTokens;
  if (remainingTextTokens < 0) return { withinLimit: false };
  if (projection.text.length === 0) {
    return { withinLimit: true, tokenCount: imageTokens };
  }

  const inspection = estimator.inspect(projection.text, Math.max(1, remainingTextTokens));
  return inspection.withinLimit
    ? { withinLimit: true, tokenCount: inspection.tokenCount + imageTokens }
    : { withinLimit: false };
}

export function projectAgentModelInputForTokenBudget(payload: unknown): {
  readonly text: string;
  readonly imageCount: number;
} {
  let imageCount = 0;
  const serialized = JSON.stringify(payload, (_key, value: unknown) => {
    if (typeof value === "bigint") return String(value);
    if (isInlineImageContent(value)) {
      imageCount += 1;
      return { ...value, data: ImageDataPlaceholder };
    }
    if (typeof value === "string" && isInlineImageDataUri(value)) {
      imageCount += 1;
      return imageDataUriPlaceholder(value);
    }
    return value;
  });

  return {
    text: serialized ?? "",
    imageCount,
  };
}

function isInlineImageContent(value: unknown): value is { type: "image"; data: string; mimeType: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.type === "image" && typeof record.data === "string" && typeof record.mimeType === "string";
}

function isInlineImageDataUri(value: string): boolean {
  return /^data:image\/[^,]+;base64,/iu.test(value);
}

function imageDataUriPlaceholder(value: string): string {
  const separator = value.indexOf(",");
  return separator === -1 ? ImageDataPlaceholder : `${value.slice(0, separator + 1)}${ImageDataPlaceholder}`;
}
