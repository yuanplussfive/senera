/** Durable host receipts, shared by admission, history and client presentation. */
export const AgentSessionInputStates = ["pending", "delivered", "completed", "failed", "cancelled"] as const;
export type AgentSessionInputState = (typeof AgentSessionInputStates)[number];
