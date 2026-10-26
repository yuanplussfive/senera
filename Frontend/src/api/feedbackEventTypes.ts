/** A user's own rating of one finished turn. */
export type FeedbackRating = "positive" | "negative";

/** Why a turn was rated; the client owns the localized labels. */
export type FeedbackCategory =
  | "task_result"
  | "instruction_following"
  | "product_interaction"
  | "service_stability"
  | "resource_cost"
  | "security_privacy"
  | "other";

export const FeedbackCategories: readonly FeedbackCategory[] = [
  "task_result",
  "instruction_following",
  "product_interaction",
  "service_stability",
  "resource_cost",
  "security_privacy",
  "other",
];

/**
 * The complete record for one turn. `rating: null` retracts it, and the
 * remaining fields then describe what was withdrawn.
 */
export interface FeedbackRecordedData {
  sessionId: string;
  requestId: string;
  rating: FeedbackRating | null;
  category?: FeedbackCategory;
  updatedAt: string;
}

function isFeedbackRating(value: unknown): value is FeedbackRating {
  return value === "positive" || value === "negative";
}

function isFeedbackCategory(value: unknown): value is FeedbackCategory {
  return typeof value === "string" && (FeedbackCategories as readonly string[]).includes(value);
}

/** Reads one durable feedback record, or `undefined` when the payload is unusable. */
export function readFeedbackRecordedData(value: unknown): FeedbackRecordedData | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const { sessionId, requestId, updatedAt } = record;
  if (typeof sessionId !== "string" || !sessionId) return undefined;
  if (typeof requestId !== "string" || !requestId) return undefined;
  if (typeof updatedAt !== "string" || !updatedAt) return undefined;
  const rating = record.rating;
  if (rating !== null && !isFeedbackRating(rating)) return undefined;
  const category = record.category;
  if (category !== undefined && !isFeedbackCategory(category)) return undefined;
  return {
    sessionId,
    requestId,
    rating,
    ...(category === undefined ? {} : { category }),
    updatedAt,
  };
}
