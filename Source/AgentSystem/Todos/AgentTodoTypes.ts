export const AgentTodoStatuses = {
  Pending: "pending",
  InProgress: "in_progress",
  Completed: "completed",
  Cancelled: "cancelled",
} as const;

export type AgentTodoStatus = (typeof AgentTodoStatuses)[keyof typeof AgentTodoStatuses];

export interface AgentTodoItem {
  readonly id: string;
  readonly content: string;
  readonly status: AgentTodoStatus;
  readonly order: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentTodoItemInput {
  readonly id: string;
  readonly content?: string;
  readonly status?: AgentTodoStatus;
}

export interface AgentTodoCounts {
  readonly total: number;
  readonly pending: number;
  readonly inProgress: number;
  readonly completed: number;
  readonly cancelled: number;
}

export interface AgentTodoSnapshot {
  readonly items: readonly AgentTodoItem[];
  readonly counts: AgentTodoCounts;
}

export interface AgentTodoPromptContext {
  readonly items: readonly AgentTodoItem[];
  readonly counts: AgentTodoCounts;
}

export interface AgentTodoPolicy {
  readonly maxItems: number;
  readonly maxContentCharacters: number;
  readonly maxResultCharacters: number;
}

export const EmptyAgentTodoCounts: AgentTodoCounts = Object.freeze({
  total: 0,
  pending: 0,
  inProgress: 0,
  completed: 0,
  cancelled: 0,
});

export const EmptyAgentTodoPromptContext: AgentTodoPromptContext = Object.freeze({
  items: [],
  counts: EmptyAgentTodoCounts,
});
