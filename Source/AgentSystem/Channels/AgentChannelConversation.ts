export const AgentChannelConversationTaskStatuses = ["pending", "active", "waiting", "completed", "cancelled"] as const;
export type AgentChannelConversationTaskStatus = (typeof AgentChannelConversationTaskStatuses)[number];

export interface AgentChannelConversationTask {
  readonly id: string;
  readonly title: string;
  readonly status: AgentChannelConversationTaskStatus;
  readonly ownerId: string;
  readonly participantIds: readonly string[];
  readonly nextAction?: string;
  readonly wakeAt?: string;
  readonly createdSequence: number;
  readonly updatedSequence: number;
  readonly revision: number;
}

export interface AgentChannelConversationState {
  readonly tasks: readonly AgentChannelConversationTask[];
  readonly totalTasks?: number;
  readonly hasMore?: boolean;
}

/** Semantic association is explicit; acknowledging inbox delivery never answers a request. */
export interface AgentChannelConversationUpdate {
  readonly taskId?: string;
  readonly revision?: number;
  readonly title?: string;
  readonly status?: AgentChannelConversationTaskStatus;
  readonly nextAction?: string | null;
  readonly wakeAt?: string | null;
  readonly messages: readonly {
    readonly sequence: number;
    readonly relation: "request" | "supplement" | "ambient";
  }[];
}
