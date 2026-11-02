import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { serializeAgentChannelConversation } from "./AgentChannelSessionIdentity.js";
import type {
  AgentChannelInboundMessage,
  AgentChannelSource,
  AgentChannelTask,
  AgentChannelTimelinePage,
} from "./AgentChannelTypes.js";
import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
import type {
  AgentChannelHistoryPage,
  AgentChannelObservedEvent,
  AgentChannelParticipant,
  AgentChannelWaitConditions,
  AgentChannelWaitRegistration,
} from "./AgentChannelParticipation.js";
import { agentChannelHistoryEntryKey } from "./AgentChannelParticipation.js";

interface ParticipantRow {
  scheduled_revision: number | null;
  actor: string | null;
  session_id: string;
  source: string;
  cursor: number;
  status: AgentChannelParticipant["status"];
  wait_id: string | null;
  request_id: string | null;
  conditions: string | null;
  wake_reason: AgentChannelParticipant["wakeReason"] | null;
  pending_sequence: number | null;
  resume_request_id: string | null;
  active_request_id: string | null;
}

/** One durable event inbox with independent, transactionally registered participant waits. */
export class AgentChannelParticipationStore {
  constructor(private readonly connection: Database.Database) {}

  append(
    message: AgentChannelInboundMessage,
    attachments?: readonly AgentUploadAttachment[],
    actor?: AgentChannelObservedEvent["actor"],
  ): AgentChannelObservedEvent {
    const conversation = serializeAgentChannelConversation(message.source);
    const key = agentChannelHistoryEntryKey(message);
    if (!key) {
      throw new Error("A channel journal entry requires its protocol message or event identity.");
    }
    this.connection
      .prepare(
        `INSERT INTO channel_events(conversation,event_key,payload) VALUES (?,?,?)
      ON CONFLICT(conversation,event_key) DO NOTHING`,
      )
      .run(
        conversation,
        key,
        JSON.stringify({ message, ...(attachments?.length ? { attachments } : {}), ...(actor ? { actor } : {}) }),
      );
    return this.decodeEvent(
      this.connection
        .prepare("SELECT sequence,payload FROM channel_events WHERE conversation=? AND event_key=?")
        .get(conversation, key) as { sequence: number; payload: string },
    );
  }

  ensure(sessionId: string, source: AgentChannelSource, startAfterSequence = 0): AgentChannelParticipant {
    this.connection
      .prepare(
        `INSERT INTO channel_participants(session_id,conversation,source,status,cursor,trigger_sequence) VALUES (?,?,?,'active',?,?)
      ON CONFLICT(session_id) DO UPDATE SET source=excluded.source,
      active_request_id=CASE WHEN channel_participants.status='paused' THEN NULL ELSE channel_participants.active_request_id END,
      status=CASE WHEN channel_participants.status='paused' THEN 'active' ELSE channel_participants.status END`,
      )
      .run(
        sessionId,
        serializeAgentChannelConversation(source),
        JSON.stringify(source),
        startAfterSequence,
        startAfterSequence,
      );
    return this.get(sessionId)!;
  }

  get(sessionId: string): AgentChannelParticipant | undefined {
    const row = this.connection.prepare("SELECT * FROM channel_participants WHERE session_id=?").get(sessionId) as
      ParticipantRow | undefined;
    return row ? this.decodeParticipant(row) : undefined;
  }

  list(): readonly AgentChannelParticipant[] {
    return (this.connection.prepare("SELECT * FROM channel_participants").all() as ParticipantRow[]).map((row) =>
      this.decodeParticipant(row),
    );
  }

  read(sessionId: string, limit: number, afterSequence?: number): AgentChannelHistoryPage {
    const participant = this.require(sessionId);
    const after = afterSequence ?? participant.cursor;
    const rows = this.connection
      .prepare(
        `SELECT sequence,payload FROM channel_events WHERE conversation=? AND sequence>?
      ORDER BY sequence LIMIT ?`,
      )
      .all(serializeAgentChannelConversation(participant.source), after, limit + 1) as {
      sequence: number;
      payload: string;
    }[];
    const entries = rows.slice(0, limit).map((row) => this.decodeEvent(row));
    return { entries, throughSequence: entries.at(-1)?.sequence ?? after, hasMore: rows.length > limit };
  }

  /** External protocols share the host archive rather than copying a second native message store. */
  archive(source: AgentChannelSource, before?: number, limit = 50): AgentChannelTimelinePage {
    if (
      !Number.isSafeInteger(limit) ||
      limit <= 0 ||
      (before !== undefined && (!Number.isSafeInteger(before) || before < 0))
    )
      throw new Error("Channel archive cursors and page sizes must be valid integers.");
    const rows = this.connection
      .prepare(
        `SELECT sequence,event_key,payload FROM channel_events
      WHERE conversation=? AND (? IS NULL OR sequence<?) ORDER BY sequence DESC LIMIT ?`,
      )
      .all(serializeAgentChannelConversation(source), before ?? null, before ?? null, limit + 1) as {
      sequence: number;
      event_key: string;
      payload: string;
    }[];
    const page = rows.slice(0, limit).reverse();
    return {
      entries: page.map((row) => ({
        sequence: row.sequence,
        key: row.event_key,
        payload: JSON.parse(row.payload) as Record<string, unknown>,
      })),
      before: rows.length > limit ? page[0]!.sequence : null,
    };
  }

  isRecalled(source: AgentChannelSource, key: string): boolean {
    if (!key.startsWith("message:")) return false;
    return Boolean(
      this.connection
        .prepare(
          `SELECT 1 FROM channel_events WHERE conversation=?
      AND json_extract(payload,'$.message.event.type')='recall'
      AND json_extract(payload,'$.message.event.messageId')=? LIMIT 1`,
        )
        .get(serializeAgentChannelConversation(source), key.slice("message:".length)),
    );
  }

  message(source: AgentChannelSource, messageId: string): AgentChannelObservedEvent | undefined {
    const row = this.connection
      .prepare("SELECT sequence,payload FROM channel_events WHERE conversation=? AND event_key=?")
      .get(serializeAgentChannelConversation(source), `message:${messageId}`) as
      { sequence: number; payload: string } | undefined;
    return row ? this.decodeEvent(row) : undefined;
  }

  messageTasks(source: AgentChannelSource, messageId: string): readonly AgentChannelTask[] {
    return (
      this.connection
        .prepare(
          `SELECT tasks.session_id,tasks.request_id FROM channel_event_tasks tasks
      JOIN channel_events events ON events.sequence=tasks.sequence WHERE events.conversation=? AND events.event_key=?
      ORDER BY tasks.session_id,tasks.request_id`,
        )
        .all(serializeAgentChannelConversation(source), `message:${messageId}`) as {
        session_id: string;
        request_id: string;
      }[]
    ).map((row) => ({ sessionId: row.session_id, requestId: row.request_id }));
  }

  hasObservedSender(sessionId: string, senderId: string): boolean {
    const participant = this.require(sessionId);
    return Boolean(
      this.connection
        .prepare(
          `SELECT 1 FROM channel_events
      WHERE conversation=? AND coalesce(json_extract(payload,'$.message.senderId'),json_extract(payload,'$.message.source.userId'))=? LIMIT 1`,
        )
        .get(serializeAgentChannelConversation(participant.source), senderId),
    );
  }

  observe(sessionId: string, sequence: number): void {
    this.connection
      .prepare("UPDATE channel_participants SET cursor=max(cursor,?) WHERE session_id=?")
      .run(sequence, sessionId);
  }

  register(
    sessionId: string,
    requestId: string,
    conditions: AgentChannelWaitConditions,
    actor?: AgentChannelParticipant["actor"],
  ): AgentChannelWaitRegistration {
    return this.connection.transaction(() => {
      const participant = this.require(sessionId);
      const waitId = randomUUID();
      this.connection
        .prepare(
          `UPDATE channel_participants SET status='waiting',wait_id=?,request_id=?,conditions=?,wake_at=?,actor=?,scheduled_revision=NULL,wake_reason=NULL,pending_sequence=NULL,resume_request_id=NULL
        WHERE session_id=?`,
        )
        .run(
          waitId,
          requestId,
          JSON.stringify(conditions),
          conditions.wakeAt ?? null,
          actor ? JSON.stringify(actor) : null,
          sessionId,
        );
      return {
        status: "waiting" as const,
        waiting: true as const,
        waitId,
        afterSequence: participant.cursor,
        conditions,
        control: { kind: "SuspendRun" as const, reason: "channel-wait" as const, id: waitId },
      };
    })();
  }

  *pending(sessionId: string): Iterable<AgentChannelObservedEvent> {
    const participant = this.require(sessionId);
    const row = this.connection
      .prepare("SELECT trigger_sequence FROM channel_participants WHERE session_id=?")
      .get(sessionId) as { trigger_sequence: number };
    yield* this.eventsAfter(sessionId, Math.max(participant.cursor, row.trigger_sequence));
  }

  *eventsAfter(sessionId: string, afterSequence: number): Iterable<AgentChannelObservedEvent> {
    const participant = this.require(sessionId);
    for (const event of this.connection
      .prepare("SELECT sequence,payload FROM channel_events WHERE conversation=? AND sequence>? ORDER BY sequence")
      .iterate(serializeAgentChannelConversation(participant.source), afterSequence)) {
      yield this.decodeEvent(event as { sequence: number; payload: string });
    }
  }

  ready(
    sessionId: string,
    reason: "event" | "time",
    sequence?: number,
    task?: { readonly id: string; readonly revision: number },
  ): AgentChannelParticipant {
    this.connection
      .prepare(
        "UPDATE channel_participants SET status='ready',wake_reason=?,pending_sequence=?,resume_request_id=?,scheduled_revision=?,conditions=CASE WHEN ? IS NULL THEN conditions ELSE json_set(coalesce(conditions,'{}'),'$.taskId',?) END WHERE session_id=? AND status<>'ready'",
      )
      .run(
        reason,
        sequence ?? null,
        `channel_${randomUUID()}`,
        task?.revision ?? null,
        task?.id ?? null,
        task?.id ?? null,
        sessionId,
      );
    return this.require(sessionId);
  }

  /** A trigger is acknowledged only after the session owns its durable turn. */
  accept(sessionId: string, requestId: string): void {
    this.connection
      .prepare(
        `UPDATE channel_participants SET status='active',active_request_id=?,trigger_sequence=max(trigger_sequence,coalesce(pending_sequence,0)),
      wait_id=NULL,request_id=NULL,conditions=NULL,wake_at=NULL,wake_reason=NULL,pending_sequence=NULL,resume_request_id=NULL,scheduled_revision=NULL
      WHERE session_id=? AND status='ready' AND resume_request_id=?`,
      )
      .run(requestId, sessionId, requestId);
  }

  bind(source: AgentChannelSource, key: string, task: AgentChannelTask): void {
    this.connection
      .prepare(
        `INSERT INTO channel_event_tasks(sequence,session_id,request_id)
      SELECT sequence,?,? FROM channel_events WHERE conversation=? AND event_key=?
      ON CONFLICT(sequence,session_id) DO NOTHING`,
      )
      .run(task.sessionId, task.requestId, serializeAgentChannelConversation(source), key);
  }

  /** Cancellation suspends existing work without erasing read receipts or replaying its backlog. */
  pause(sessionId: string, requestId?: string): void {
    this.connection
      .prepare(
        `UPDATE channel_participants SET status='paused',
      trigger_sequence=max(trigger_sequence,coalesce((SELECT max(sequence) FROM channel_events
        WHERE conversation=channel_participants.conversation),0)),
      wait_id=NULL,request_id=NULL,conditions=NULL,wake_at=NULL,wake_reason=NULL,
      pending_sequence=NULL,resume_request_id=NULL,active_request_id=NULL,scheduled_revision=NULL WHERE session_id=? AND
      (? IS NULL OR active_request_id=? OR resume_request_id=? OR request_id=?)`,
      )
      .run(sessionId, requestId ?? null, requestId ?? null, requestId ?? null, requestId ?? null);
  }

  removeRequests(sessionId: string, requestIds: readonly string[]): void {
    this.connection.transaction(() => {
      if (requestIds.length) this.pause(sessionId);
      for (const requestId of requestIds) {
        const rows = this.connection
          .prepare("SELECT sequence FROM channel_event_tasks WHERE session_id=? AND request_id=?")
          .all(sessionId, requestId) as { sequence: number }[];
        this.connection
          .prepare("DELETE FROM channel_event_tasks WHERE session_id=? AND request_id=?")
          .run(sessionId, requestId);
        for (const row of rows) {
          if (!this.connection.prepare("SELECT 1 FROM channel_event_tasks WHERE sequence=?").get(row.sequence)) {
            this.removeSequence(row.sequence);
          }
        }
      }
    })();
  }

  removeEvent(source: AgentChannelSource, key: string): void {
    this.connection.transaction(() => {
      const row = this.connection
        .prepare("SELECT sequence FROM channel_events WHERE conversation=? AND event_key=?")
        .get(serializeAgentChannelConversation(source), key) as { sequence: number } | undefined;
      if (row) this.removeSequence(row.sequence);
    })();
  }

  private removeSequence(sequence: number): void {
    this.connection
      .prepare(
        `UPDATE channel_participants SET status='active',conditions=NULL,wake_at=NULL,wait_id=NULL,request_id=NULL,
      pending_sequence=NULL,resume_request_id=NULL,wake_reason=NULL,scheduled_revision=NULL
      WHERE json_extract(conditions,'$.taskId') IN (SELECT id FROM channel_conversation_tasks WHERE created_sequence=?)`,
      )
      .run(sequence);
    this.connection
      .prepare(
        `UPDATE channel_participants SET status=CASE WHEN conditions IS NULL THEN 'active' ELSE 'waiting' END,
      pending_sequence=NULL,resume_request_id=NULL,wake_reason=NULL,scheduled_revision=NULL WHERE status='ready' AND pending_sequence=?`,
      )
      .run(sequence);
    this.connection.prepare("DELETE FROM channel_events WHERE sequence=?").run(sequence);
  }

  event(sequence: number): AgentChannelObservedEvent {
    const row = this.connection
      .prepare("SELECT sequence,payload FROM channel_events WHERE sequence=?")
      .get(sequence) as { sequence: number; payload: string } | undefined;
    if (!row) throw new Error("The pending channel event is missing from its journal.");
    return this.decodeEvent(row);
  }

  cancel(sessionId: string): void {
    this.connection.prepare("DELETE FROM channel_participants WHERE session_id=?").run(sessionId);
  }

  removeSession(sessionId: string): void {
    this.connection.transaction(() => {
      const requests = this.connection
        .prepare("SELECT DISTINCT request_id FROM channel_event_tasks WHERE session_id=?")
        .all(sessionId) as { request_id: string }[];
      this.removeRequests(
        sessionId,
        requests.map((row) => row.request_id),
      );
      this.cancel(sessionId);
    })();
  }

  clear(source: AgentChannelSource): void {
    const conversation = serializeAgentChannelConversation(source);
    this.connection.transaction(() => {
      this.connection.prepare("DELETE FROM channel_participants WHERE conversation=?").run(conversation);
      this.connection.prepare("DELETE FROM channel_events WHERE conversation=?").run(conversation);
    })();
  }

  private require(sessionId: string): AgentChannelParticipant {
    const participant = this.get(sessionId);
    if (!participant) throw new Error("The current session has no channel participation state.");
    return participant;
  }

  private decodeEvent(row: { sequence: number; payload: string }): AgentChannelObservedEvent {
    return { ...(JSON.parse(row.payload) as Omit<AgentChannelObservedEvent, "sequence">), sequence: row.sequence };
  }

  private decodeParticipant(row: ParticipantRow): AgentChannelParticipant {
    return {
      sessionId: row.session_id,
      ...(row.scheduled_revision === null ? {} : { scheduledRevision: row.scheduled_revision }),
      ...(row.actor ? { actor: JSON.parse(row.actor) as AgentChannelParticipant["actor"] } : {}),
      source: JSON.parse(row.source) as AgentChannelSource,
      cursor: row.cursor,
      status: row.status,
      ...(row.wait_id ? { waitId: row.wait_id } : {}),
      ...(row.request_id ? { requestId: row.request_id } : {}),
      ...(row.conditions ? { conditions: JSON.parse(row.conditions) as AgentChannelWaitConditions } : {}),
      ...(row.pending_sequence === null ? {} : { pendingSequence: row.pending_sequence }),
      ...(row.resume_request_id ? { resumeRequestId: row.resume_request_id } : {}),
      ...(row.active_request_id ? { activeRequestId: row.active_request_id } : {}),
      ...(row.wake_reason ? { wakeReason: row.wake_reason } : {}),
    };
  }
}
