import type Database from "better-sqlite3";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import type { AgentChannelKind, AgentChannelSendReplyOptions, AgentChannelSource } from "./AgentChannelTypes.js";
import type { AgentChannelDeliveryReceipt } from "./AgentChannelDelivery.js";
import { serializeError } from "../Diagnostics/AgentErrorSerializer.js";

export interface AgentChannelOutboxEntry {
  readonly id: string;
  readonly source: AgentChannelSource;
  readonly content: string;
  readonly options?: AgentChannelSendReplyOptions;
  readonly attempts: number;
  readonly retryAt?: number;
  readonly state: "pending" | "sending" | "sent" | "failed" | "uncertain";
  readonly receipt?: AgentChannelDeliveryReceipt;
}

/** One record per transport payload, shared by tools and authored replies. */
export class AgentChannelOutbox {
  constructor(private readonly connection: Database.Database) {}

  accept(entry: AgentChannelOutboxEntry): AgentChannelOutboxEntry {
    const digest = sha256HexOfCanonicalJson({ source: entry.source, content: entry.content, options: entry.options });
    const existing = this.connection.prepare("SELECT digest,payload FROM channel_outbox WHERE id=?").get(entry.id) as
      { digest: string; payload: string } | undefined;
    if (existing) {
      if (existing.digest !== digest) throw new Error("A channel delivery ID cannot identify different payloads.");
      return JSON.parse(existing.payload) as AgentChannelOutboxEntry;
    }
    this.connection
      .prepare("INSERT INTO channel_outbox(id,platform,lane,state,digest,payload) VALUES (?,?,?,?,?,?)")
      .run(entry.id, entry.source.platform, JSON.stringify(entry.source), entry.state, digest, JSON.stringify(entry));
    return entry;
  }

  save(entry: AgentChannelOutboxEntry): void {
    const receipt =
      entry.receipt?.status === "failed"
        ? { ...entry.receipt, error: serializeError(entry.receipt.error) }
        : entry.receipt;
    this.connection
      .prepare("UPDATE channel_outbox SET state=?,payload=? WHERE id=?")
      .run(entry.state, JSON.stringify({ ...entry, receipt }), entry.id);
  }

  recover(platform: AgentChannelKind, active: ReadonlySet<string>): AgentChannelOutboxEntry[] {
    const entries = (
      this.connection
        .prepare(
          "SELECT payload FROM channel_outbox WHERE platform=? AND state IN ('pending','sending') ORDER BY sequence",
        )
        .all(platform) as { payload: string }[]
    ).map(({ payload }) => JSON.parse(payload) as AgentChannelOutboxEntry);
    return entries
      .filter((entry) => !active.has(entry.id))
      .map((entry) => {
        if (entry.state !== "sending") return entry;
        const uncertain: AgentChannelOutboxEntry = {
          ...entry,
          state: "uncertain",
          receipt: {
            status: "failed",
            code: "delivery_unknown",
            attempts: entry.attempts,
            error: {
              message: "The process exited before the platform receipt was committed. Delivery requires confirmation.",
            },
          },
        };
        this.save(uncertain);
        return uncertain;
      });
  }
}
