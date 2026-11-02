import { AgentFeedbackCategoryValues, AgentFeedbackRatings } from "./generatedFeedbackContract";
export type {
  AgentFeedbackRating as FeedbackRating,
  AgentFeedbackCategory as FeedbackCategory,
  AgentFeedbackRecord as FeedbackRecordedData,
} from "./generatedFeedbackContract";
import type {
  AgentFeedbackRating as FeedbackRating,
  AgentFeedbackCategory as FeedbackCategory,
  AgentFeedbackRecord as FeedbackRecordedData,
} from "./generatedFeedbackContract";
export const FeedbackCategories = AgentFeedbackCategoryValues;

function isFeedbackRating(value: unknown): value is FeedbackRating {
  return Object.values(AgentFeedbackRatings).some((rating) => rating === value);
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
  if (typeof updatedAt !== "string" || !Number.isFinite(Date.parse(updatedAt))) return undefined;
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
