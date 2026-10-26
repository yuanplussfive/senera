/**
 * Message feedback: a user's own rating of one finished turn.
 *
 * Feedback annotates the conversation without joining it — the model never
 * sees it and it changes no execution decision. It is a durable, whole-record
 * replacement per turn, so a later write (including a retraction) always wins
 * and history replay reproduces the latest state.
 */

export const AgentFeedbackRatings = {
  Positive: "positive",
  Negative: "negative",
} as const;

export type AgentFeedbackRating = (typeof AgentFeedbackRatings)[keyof typeof AgentFeedbackRatings];

/** Why a turn was rated. Stable ids; the client owns their localized labels. */
export const AgentFeedbackCategories = {
  TaskResult: "task_result",
  InstructionFollowing: "instruction_following",
  ProductInteraction: "product_interaction",
  ServiceStability: "service_stability",
  ResourceCost: "resource_cost",
  SecurityPrivacy: "security_privacy",
  Other: "other",
} as const;

export type AgentFeedbackCategory = (typeof AgentFeedbackCategories)[keyof typeof AgentFeedbackCategories];

export const AgentFeedbackCategoryValues: readonly AgentFeedbackCategory[] = Object.values(AgentFeedbackCategories);

/**
 * The complete record for one turn. `rating: null` retracts the record; the
 * remaining fields then describe what was withdrawn.
 */
export interface AgentFeedbackRecord {
  readonly sessionId: string;
  /** Turn the rating belongs to; also the durable envelope's request id. */
  readonly requestId: string;
  readonly rating: AgentFeedbackRating | null;
  readonly category?: AgentFeedbackCategory;
  readonly updatedAt: string;
}
