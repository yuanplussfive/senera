import type { AgentPromptWireSnapshot } from "./AgentPromptWireSnapshot.js";

export interface AgentModelTimingRecord {
  stage: string;
  requestId: string;
  providerId: string;
  model: string;
  status: "completed" | "failed";
  firstTokenMs?: number;
  durationMs: number;
  requestCharacters: number;
  responseCharacters: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Redacted wire/cache identity for diagnosing provider-prefix reuse. */
  promptCache?: AgentPromptWireSnapshot;
  error?: string;
}

export type AgentModelTimingSink = (record: AgentModelTimingRecord) => void | Promise<void>;
