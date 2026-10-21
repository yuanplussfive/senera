export const AgentTodoStatuses = {
  Pending: "pending",
  InProgress: "in_progress",
  Completed: "completed",
  Cancelled: "cancelled",
} as const;

export type AgentTodoStatus = (typeof AgentTodoStatuses)[keyof typeof AgentTodoStatuses];

/** Stable model-facing Tool names shared by runtime, prompts, and extensions. */
export const AgentTodoToolNames = {
  Add: "TodoAdd",
  Update: "TodoUpdate",
  Read: "TodoRead",
} as const;

export const AgentTodoChangeSources = {
  Host: "host",
  Model: "model",
} as const;

export type AgentTodoChangeSource = (typeof AgentTodoChangeSources)[keyof typeof AgentTodoChangeSources];

export interface AgentTodoItem {
  readonly id: string;
  readonly content: string;
  readonly status: AgentTodoStatus;
  readonly order: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentTodoAddTaskInput {
  readonly content: string;
}

export type AgentTodoUpdateItemInput =
  | {
      readonly id: string;
      readonly content: string;
      readonly status?: AgentTodoStatus;
    }
  | {
      readonly id: string;
      readonly content?: never;
      readonly status: AgentTodoStatus;
    };

export interface AgentTodoTaskReference {
  readonly id: string;
  readonly status: AgentTodoStatus;
}

export interface AgentTodoAddResult {
  readonly created: readonly AgentTodoTaskReference[];
  readonly counts: AgentTodoCounts;
}

export interface AgentTodoUpdateResult {
  readonly updated: readonly AgentTodoTaskReference[];
  readonly counts: AgentTodoCounts;
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
