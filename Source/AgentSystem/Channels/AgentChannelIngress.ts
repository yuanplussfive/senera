import type Database from "better-sqlite3";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { agentChannelHistoryEntryKey } from "./AgentChannelParticipation.js";
import { serializeAgentChannelConversation } from "./AgentChannelSessionIdentity.js";
import type { AgentChannelInboundMessage, AgentChannelKind, AgentChannelSource } from "./AgentChannelTypes.js";

export interface AgentChannelIngressEntry {
  readonly id: string;
  readonly message: AgentChannelInboundMessage;
  readonly targets: readonly { readonly source: AgentChannelSource; readonly sessionId: string }[];
  readonly state: "pending" | "accepted" | "failed" | "discarded";
  readonly error?: string;
}

/** Captures protocol input before media I/O. Never persists native request headers or raw callbacks. */
export class AgentChannelIngress {
  private readonly running = new Map<string, Promise<void>>();

  constructor(private readonly connection: Database.Database) {}

  capture(message: AgentChannelInboundMessage, targets: AgentChannelIngressEntry["targets"]): AgentChannelIngressEntry {
    const key = agentChannelHistoryEntryKey(message);
    if (!key) throw new Error("Durable channel input requires a native event or message identity.");
    const id = sha256HexOfCanonicalJson({ conversation: serializeAgentChannelConversation(message.source), key });
    const { raw: _raw, ...normalized } = message;
    const entry: AgentChannelIngressEntry = { id, message: normalized, targets, state: "pending" };
    this.connection
      .prepare(
        "INSERT INTO channel_ingress(id,platform,state,payload) VALUES (?,?,'pending',?) ON CONFLICT(id) DO NOTHING",
      )
      .run(id, message.source.platform, JSON.stringify(entry));
    const row = this.connection.prepare("SELECT payload FROM channel_ingress WHERE id=?").get(id) as {
      payload: string;
    };
    return JSON.parse(row.payload) as AgentChannelIngressEntry;
  }

  run(entry: AgentChannelIngressEntry, dispatch: () => Promise<"pending" | "accepted" | "discarded">): Promise<void> {
    const active = this.running.get(entry.id);
    if (active) return active;
    if (entry.state === "accepted" || entry.state === "discarded") return Promise.resolve();
    const execution = Promise.resolve()
      .then(async () => {
        this.save({ ...entry, state: "pending", error: undefined });
        try {
          this.save({ ...entry, state: await dispatch(), error: undefined });
        } catch (error) {
          this.save({ ...entry, state: "failed", error: errorMessage(error) });
          throw error;
        }
      })
      .finally(() => {
        this.running.delete(entry.id);
      });
    this.running.set(entry.id, execution);
    return execution;
  }

  pending(platform: AgentChannelKind): AgentChannelIngressEntry[] {
    return (
      this.connection
        .prepare("SELECT payload FROM channel_ingress WHERE platform=? AND state='pending' ORDER BY sequence")
        .all(platform) as { payload: string }[]
    ).map(({ payload }) => JSON.parse(payload) as AgentChannelIngressEntry);
  }

  async drain(): Promise<void> {
    await Promise.allSettled(this.running.values());
  }

  private save(entry: AgentChannelIngressEntry): void {
    const payload =
      entry.state === "accepted" || entry.state === "discarded"
        ? { ...entry, message: { ...entry.message, attachments: undefined, segments: undefined } }
        : entry;
    this.connection
      .prepare("UPDATE channel_ingress SET state=?,payload=? WHERE id=?")
      .run(entry.state, JSON.stringify(payload), entry.id);
  }
}
