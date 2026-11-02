/** Browser-safe description of the normalized Pi input, before provider serialization. */
export type AgentModelContextCategory =
  "system" | "tools" | "user" | "thinking" | "preface" | "assistant" | "toolCall" | "toolResult";

export interface AgentModelContextSection {
  id: string;
  category: AgentModelContextCategory;
  label: string;
  tokens: number;
  characters: number;
  images: number;
  resourceUri?: string;
  contentError?: string;
  toolCallId?: string;
  isError?: boolean;
}

export interface AgentModelContextSnapshot {
  format: "pi-input/v1";
  scope: "native" | "baml-input";
  measurement: "local_estimate";
  contextWindow: number;
  reserveTokens: number;
  estimatedTokens: number;
  sections: AgentModelContextSection[];
}
