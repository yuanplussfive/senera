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
  error?: string;
}

export type AgentModelTimingSink = (record: AgentModelTimingRecord) => void | Promise<void>;
