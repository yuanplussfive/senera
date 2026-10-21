export const AgentSessionForkPiMutationKinds = {
  None: "none",
  Fork: "fork",
} as const;

export type AgentSessionForkPiMutation =
  | { readonly kind: typeof AgentSessionForkPiMutationKinds.None }
  | {
      readonly kind: typeof AgentSessionForkPiMutationKinds.Fork;
      readonly entryId: string;
      readonly modelProviderId?: string;
    };

export interface AgentSessionForkMutation {
  readonly mutationId: string;
  readonly sourceSessionId: string;
  readonly targetSessionId: string;
  readonly throughRequestId: string;
  readonly pi: AgentSessionForkPiMutation;
  readonly createdAt: string;
}
