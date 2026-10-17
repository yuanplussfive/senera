import { randomUUID } from "node:crypto";
import type { AgentEventSink } from "../Events/AgentEvent.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { emitAgentEvent } from "../Events/AgentEvent.js";
import { AgentEventKinds } from "../Events/AgentEventCatalog.js";
import { AgentTodoSqliteStore } from "./AgentTodoSqliteStore.js";
import {
  AgentTodoChangeSources,
  AgentTodoStatuses,
  AgentTodoToolNames,
  EmptyAgentTodoPromptContext,
  type AgentTodoAddResult,
  type AgentTodoAddTaskInput,
  type AgentTodoChangeSource,
  type AgentTodoCounts,
  type AgentTodoItem,
  type AgentTodoPolicy,
  type AgentTodoPromptContext,
  type AgentTodoSnapshot,
  type AgentTodoTaskReference,
  type AgentTodoUpdateItemInput,
  type AgentTodoUpdateResult,
} from "./AgentTodoTypes.js";

export interface AgentTodoServiceOptions {
  readonly store: AgentTodoSqliteStore;
  readonly policy: AgentTodoPolicy;
}

interface AgentTodoMutationContext {
  readonly sessionId: string;
  readonly onEvent?: AgentEventSink;
  readonly requestId?: string;
  readonly source?: AgentTodoChangeSource;
}

export interface AgentTodoAddInput extends AgentTodoMutationContext {
  readonly tasks: readonly AgentTodoAddTaskInput[];
  readonly now?: Date;
}

export interface AgentTodoUpdateInput extends AgentTodoMutationContext {
  readonly updates: readonly AgentTodoUpdateItemInput[];
  readonly now?: Date;
}

export class AgentTodoService {
  private readonly policy: AgentTodoPolicy;

  constructor(private readonly options: AgentTodoServiceOptions) {
    this.policy = options.policy;
    validatePolicy(this.policy);
  }

  read(sessionId: string): AgentTodoSnapshot {
    return this.snapshot(this.options.store.list(sessionId));
  }

  /** Snapshot fingerprint used by orchestration to detect a model plan change. */
  fingerprint(sessionId: string): string {
    return sha256HexOfCanonicalJson(this.read(sessionId));
  }

  add(input: AgentTodoAddInput): AgentTodoAddResult {
    const sessionId = requireText(input.sessionId, "Todo session id");
    if (input.tasks.length === 0) throw new Error("Add at least one Todo task.");

    const current = this.options.store.list(sessionId);
    const timestamp = (input.now ?? new Date()).toISOString();
    const created = input.tasks.map((task, index) => ({
      id: randomUUID(),
      content: requireText(task.content, "Todo content"),
      status: AgentTodoStatuses.Pending,
      order: current.length + index,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
    const snapshot = this.commit(sessionId, [...current, ...created], input);

    return {
      created: taskReferences(created),
      counts: snapshot.counts,
    };
  }

  update(input: AgentTodoUpdateInput): AgentTodoUpdateResult {
    const sessionId = requireText(input.sessionId, "Todo session id");
    if (input.updates.length === 0) throw new Error("Update at least one Todo task.");

    const current = this.options.store.list(sessionId);
    const byId = new Map(current.map((item) => [item.id, item]));
    const seen = new Set<string>();
    const changedIds: string[] = [];
    const timestamp = (input.now ?? new Date()).toISOString();

    for (const update of input.updates) {
      const id = requireText(update.id, "Todo id");
      if (seen.has(id)) throw new Error(`Todo ${id} is updated more than once in one request.`);
      seen.add(id);

      const previous = byId.get(id);
      if (!previous) throw new Error(`Todo ${id} does not exist. Use ${AgentTodoToolNames.Add} to create it.`);

      const content = update.content === undefined ? previous.content : requireText(update.content, "Todo content");
      const status = update.status ?? previous.status;
      if (content === previous.content && status === previous.status) continue;

      byId.set(id, { ...previous, content, status, updatedAt: timestamp });
      changedIds.push(id);
    }

    if (changedIds.length === 0) {
      return { updated: [], counts: this.snapshot(current).counts };
    }

    const snapshot = this.commit(sessionId, [...byId.values()], input);
    const committedById = new Map(snapshot.items.map((item) => [item.id, item]));
    return {
      updated: changedIds.flatMap((id) => {
        const item = committedById.get(id);
        return item ? [{ id: item.id, status: item.status }] : [];
      }),
      counts: snapshot.counts,
    };
  }

  promptContext(sessionId?: string): AgentTodoPromptContext {
    if (!sessionId) return EmptyAgentTodoPromptContext;
    const snapshot = this.read(sessionId);
    return {
      items: snapshot.items.filter(
        (item) => item.status === AgentTodoStatuses.Pending || item.status === AgentTodoStatuses.InProgress,
      ),
      counts: snapshot.counts,
    };
  }

  private commit(
    sessionId: string,
    items: readonly AgentTodoItem[],
    context: Pick<AgentTodoMutationContext, "onEvent" | "requestId" | "source">,
  ): AgentTodoSnapshot {
    validateItems(items, this.policy);
    this.snapshot(items);
    this.options.store.replace(sessionId, items);
    const snapshot = this.snapshot(this.options.store.list(sessionId));
    void emitAgentEvent(context.onEvent, {
      kind: AgentEventKinds.TodoListWritten,
      context: { sessionId, ...(context.requestId ? { requestId: context.requestId } : {}) },
      data: { snapshot, source: context.source ?? AgentTodoChangeSources.Model },
    });
    return snapshot;
  }

  private snapshot(items: readonly AgentTodoItem[]): AgentTodoSnapshot {
    const snapshot = { items: [...items], counts: countItems(items) };
    const serialized = JSON.stringify(snapshot);
    if (serialized.length > this.policy.maxResultCharacters) {
      throw new Error("Todo result exceeds the configured result limit.");
    }
    return snapshot;
  }
}

function taskReferences(items: readonly AgentTodoTaskReference[]): AgentTodoTaskReference[] {
  return items.map(({ id, status }) => ({ id, status }));
}

function validateItems(items: readonly AgentTodoItem[], policy: AgentTodoPolicy): void {
  if (items.length > policy.maxItems) throw new Error(`Todo list exceeds ${policy.maxItems} items.`);
  if (items.filter((item) => item.status === AgentTodoStatuses.InProgress).length > 1) {
    throw new Error("At most one Todo may be in_progress.");
  }

  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`Todo id is duplicated: ${item.id}.`);
    ids.add(item.id);
    if (item.content.length > policy.maxContentCharacters) {
      throw new Error(`Todo ${item.id} exceeds ${policy.maxContentCharacters} content characters.`);
    }
  }
}

function countItems(items: readonly AgentTodoItem[]): AgentTodoCounts {
  return {
    total: items.length,
    pending: items.filter((item) => item.status === AgentTodoStatuses.Pending).length,
    inProgress: items.filter((item) => item.status === AgentTodoStatuses.InProgress).length,
    completed: items.filter((item) => item.status === AgentTodoStatuses.Completed).length,
    cancelled: items.filter((item) => item.status === AgentTodoStatuses.Cancelled).length,
  };
}

function requireText(value: string | undefined, label: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new Error(`${label} cannot be empty.`);
  return normalized;
}

function validatePolicy(policy: AgentTodoPolicy): void {
  for (const [name, value] of Object.entries(policy)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Todo ${name} policy must be a positive safe integer.`);
    }
  }
}
