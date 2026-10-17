export const AgentSessionHistoryMutationKinds = {
  Truncate: "truncate",
} as const;

export const AgentSessionPiMutationKinds = {
  None: "none",
  Reset: "reset",
  Rewind: "rewind",
} as const;

export type AgentSessionPiMutation =
  | { readonly kind: typeof AgentSessionPiMutationKinds.None }
  | { readonly kind: typeof AgentSessionPiMutationKinds.Reset; readonly modelProviderId?: string }
  | {
      readonly kind: typeof AgentSessionPiMutationKinds.Rewind;
      readonly entryId: string;
      readonly modelProviderId?: string;
    };

export interface AgentSessionHistoryMutation {
  readonly mutationId: string;
  readonly kind: typeof AgentSessionHistoryMutationKinds.Truncate;
  readonly sessionId: string;
  readonly fromRequestId: string;
  readonly pi: AgentSessionPiMutation;
  readonly createdAt: string;
}
