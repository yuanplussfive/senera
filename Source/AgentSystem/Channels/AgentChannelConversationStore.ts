import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { AgentChannelInboundMessage } from "./AgentChannelTypes.js";
import type {
  AgentChannelConversationState,
  AgentChannelConversationTask,
  AgentChannelConversationUpdate,
} from "./AgentChannelConversation.js";
import {
  AgentChannelConversationSqlStatements,
  type AgentChannelConversationTaskRow,
} from "./AgentChannelConversationSqlStatements.js";

/** Semantic decisions share the same transaction/journal as participation, waits and receipts. */
export class AgentChannelConversationStore {
  private readonly sql;
  constructor(private readonly db: Database.Database) {
    this.sql = new AgentChannelConversationSqlStatements(db);
  }

  state(sessionId: string): AgentChannelConversationState {
    return { tasks: this.sql.list.all({ sessionId }).map(decode) };
  }

  task(sessionId: string, id: string): AgentChannelConversationTask {
    const row = this.sql.get.get({ sessionId, id });
    if (!row) throw new Error("The task does not belong to the current channel lane.");
    return decode(row);
  }

  next(sessionId: string, now: Date): AgentChannelConversationTask | undefined {
    const { tasks } = this.state(sessionId);
    return tasks
      .filter(
        (task) =>
          task.status === "pending" ||
          (task.status === "waiting" && task.wakeAt && Date.parse(task.wakeAt) <= now.getTime()),
      )
      .sort((a, b) => a.createdSequence - b.createdSequence || a.id.localeCompare(b.id))
      .find((task) => !this.sql.evaluated.get({ taskId: task.id, revision: task.revision }));
  }

  evaluated(sessionId: string, taskId: string, revision: number, requestId: string): void {
    const task = this.sql.get.get({ sessionId, id: taskId });
    if (task) this.sql.evaluate.run({ taskId, revision, requestId });
  }

  stop(sessionId: string): void {
    this.sql.stop.run({ sessionId });
  }

  nextWake(sessionId: string): number | undefined {
    const { tasks } = this.state(sessionId);
    const times = tasks
      .filter(
        (task) =>
          task.status === "waiting" &&
          task.wakeAt &&
          !this.sql.evaluated.get({ taskId: task.id, revision: task.revision }),
      )
      .map((task) => Date.parse(task.wakeAt!));
    return times.length ? Math.min(...times) : undefined;
  }

  update(
    sessionId: string,
    callId: string,
    input: AgentChannelConversationUpdate,
    selfId?: string,
  ): AgentChannelConversationState {
    return this.db.transaction(() => {
      const replay = this.sql.decision.get({ sessionId, callId });
      if (replay) return JSON.parse(replay.result) as AgentChannelConversationState;
      if (new Set(input.messages.map((item) => item.sequence)).size !== input.messages.length)
        throw new Error("Each observed message must have one disposition per decision.");
      if (input.title !== undefined && !input.title.trim()) throw new Error("A task title cannot be blank.");
      if (
        !input.messages.length &&
        !input.taskId &&
        input.title === undefined &&
        input.status === undefined &&
        input.nextAction === undefined &&
        input.wakeAt === undefined
      )
        return this.state(sessionId);
      const commit = () => {
        const state = this.state(sessionId);
        this.sql.commit.run({ sessionId, callId, result: JSON.stringify(state) });
        return state;
      };
      const messages = input.messages.map((item) => {
        const row = this.sql.event.get({ sessionId, sequence: item.sequence });
        if (!row) throw new Error("Associate only messages already observed in this conversation.");
        const { message } = JSON.parse(row.payload) as { message: AgentChannelInboundMessage };
        if (message.event || message.task?.sessionId === sessionId)
          throw new Error("Only inbound chat messages can own requests.");
        const sender = message.senderId ?? message.source.userId;
        if (sender === selfId) throw new Error("Your own messages cannot create inbound requests.");
        const previous = this.sql.association.get({ sessionId, sequence: item.sequence });
        if (previous?.task_id && previous.task_id !== input.taskId)
          throw new Error("This message already belongs to another task. Read that task before changing its scope.");
        return { ...item, sender, previous };
      });
      const attached = messages.filter((item) => item.relation !== "ambient");
      if (!input.taskId && !attached.length) {
        if (input.status || input.title || input.nextAction || input.wakeAt)
          throw new Error("Task fields require a request or an existing task.");
        for (const item of messages) this.sql.associate.run({ sessionId, ...item, taskId: null });
        return commit();
      }
      const previous = input.taskId ? this.task(sessionId, input.taskId) : undefined;
      if (previous && input.revision !== previous.revision)
        throw new Error("The task changed. Read its current revision before updating it.");
      const origin = attached.find((item) => item.relation === "request");
      if (!previous && (!origin || !input.title?.trim()))
        throw new Error("A new task requires an observed request and a title.");
      const id = previous?.id ?? randomUUID();
      const status = input.status ?? previous?.status ?? "pending";
      if (input.wakeAt && status !== "waiting") throw new Error("Only a waiting task can have a wakeAt.");
      if (previous && ["completed", "cancelled"].includes(previous.status))
        throw new Error("A closed task cannot be silently reopened. Register a new request.");
      const ownerId = previous?.ownerId ?? origin!.sender;
      if (
        status === "cancelled" &&
        !messages.some(
          (item) =>
            item.sender === ownerId &&
            item.relation !== "ambient" &&
            (!previous || item.sequence > previous.updatedSequence),
        )
      )
        throw new Error("Cancelling a task requires an observed message from its owner.");
      if (status === "active" && this.state(sessionId).tasks.some((task) => task.status === "active" && task.id !== id))
        throw new Error("Suspend or finish the active task before activating another one.");
      const wakeAt =
        status === "waiting"
          ? input.wakeAt === undefined
            ? previous?.wakeAt
            : (input.wakeAt ?? undefined)
          : undefined;
      if (wakeAt && (!Number.isFinite(Date.parse(wakeAt)) || status !== "waiting"))
        throw new Error("Only a waiting task can have a valid wakeAt.");
      const args = {
        id,
        sessionId,
        callId,
        status,
        ownerId,
        title: input.title?.trim() ?? previous!.title,
        participants: JSON.stringify([
          ...new Set([...(previous?.participantIds ?? [ownerId]), ...attached.map((item) => item.sender)]),
        ]),
        nextAction: input.nextAction === undefined ? (previous?.nextAction ?? null) : input.nextAction,
        wakeAt: status === "waiting" ? (wakeAt ?? null) : null,
        createdSequence: previous?.createdSequence ?? origin!.sequence,
        updatedSequence: Math.max(previous?.updatedSequence ?? 0, ...messages.map((item) => item.sequence)),
        revision: previous?.revision ?? 0,
      };
      if (
        previous &&
        previous.status === status &&
        previous.title === args.title &&
        previous.nextAction === (args.nextAction ?? undefined) &&
        previous.wakeAt === (args.wakeAt ?? undefined) &&
        JSON.stringify(previous.participantIds) === args.participants &&
        previous.updatedSequence === args.updatedSequence &&
        messages.every(
          (item) =>
            item.previous?.disposition === item.relation &&
            item.previous.task_id === (item.relation === "ambient" ? null : id),
        )
      )
        return commit();
      if (previous) this.sql.update.run(args);
      else this.sql.create.run(args);
      for (const item of messages)
        this.sql.associate.run({ sessionId, ...item, taskId: item.relation === "ambient" ? null : id });
      return commit();
    })();
  }

  /** Unclassified messages still require review; unrelated classified chatter does not block a task. */
  relevant(sessionId: string, sequence: number, taskId?: string): boolean {
    const association = this.sql.association.get({ sessionId, sequence });
    if (!association) return true;
    return association.disposition !== "ambient" && (!taskId || association.task_id === taskId);
  }
}

function decode(row: AgentChannelConversationTaskRow): AgentChannelConversationTask {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    ownerId: row.owner_id,
    participantIds: JSON.parse(row.participant_ids) as string[],
    ...(row.next_action === null ? {} : { nextAction: row.next_action }),
    ...(row.wake_at === null ? {} : { wakeAt: row.wake_at }),
    createdSequence: row.created_sequence,
    updatedSequence: row.updated_sequence,
    revision: row.revision,
  };
}
