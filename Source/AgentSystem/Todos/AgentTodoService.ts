import type { AgentEventSink } from "../Events/AgentEvent.js";
import { emitAgentEvent } from "../Events/AgentEvent.js";
import { AgentEventKinds } from "../Events/AgentEventCatalog.js";
import { AgentTodoSqliteStore } from "./AgentTodoSqliteStore.js";
import {
  AgentTodoStatuses,
  EmptyAgentTodoPromptContext,
  type AgentTodoCounts,
  type AgentTodoItem,
  type AgentTodoItemInput,
  type AgentTodoPolicy,
  type AgentTodoPromptContext,
  type AgentTodoSnapshot,
} from "./AgentTodoTypes.js";

export interface AgentTodoServiceOptions {
  readonly store: AgentTodoSqliteStore;
  readonly policy: AgentTodoPolicy;
}

export interface AgentTodoWriteInput {
  readonly sessionId: string;
  readonly items: readonly AgentTodoItemInput[];
  readonly merge: boolean;
  readonly onEvent?: AgentEventSink;
  readonly requestId?: string;
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

  write(input: AgentTodoWriteInput): AgentTodoSnapshot {
    const current = input.merge ? this.options.store.list(input.sessionId) : [];
    const next = input.merge ? mergeItems(current, input.items, input.now) : createItems(input.items, input.now);
    const normalized = normalizeItems(next);
    validateItems(normalized, this.policy);
    this.snapshot(normalized);
    this.options.store.replace(input.sessionId, normalized);
    const snapshot = this.snapshot(this.options.store.list(input.sessionId));
    void emitAgentEvent(input.onEvent, {
      kind: AgentEventKinds.TodoListWritten,
      context: { sessionId: input.sessionId, ...(input.requestId ? { requestId: input.requestId } : {}) },
      data: { snapshot },
    });
    return snapshot;
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

  private snapshot(items: readonly AgentTodoItem[]): AgentTodoSnapshot {
    const snapshot = { items: [...items], counts: countItems(items) };
    const serialized = JSON.stringify(snapshot);
    if (serialized.length > this.policy.maxResultCharacters) {
      throw new Error("Todo result exceeds the configured result limit.");
    }
    return snapshot;
  }
}

function createItems(input: readonly AgentTodoItemInput[], now = new Date()): AgentTodoItem[] {
  const timestamp = now.toISOString();
  return input.map((item, index) => ({
    id: requireText(item.id, "Todo id"),
    content: requireText(item.content, "Todo content"),
    status: item.status ?? AgentTodoStatuses.Pending,
    order: index,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
}

function mergeItems(
  current: readonly AgentTodoItem[],
  input: readonly AgentTodoItemInput[],
  now = new Date(),
): AgentTodoItem[] {
  const timestamp = now.toISOString();
  const byId = new Map(current.map((item) => [item.id, item]));
  const seen = new Set<string>();
  for (const entry of input) {
    const id = requireText(entry.id, "Todo id");
    if (seen.has(id)) throw new Error(`Todo id is duplicated in one write: ${id}.`);
    seen.add(id);
    const previous = byId.get(id);
    if (!previous && !entry.content) throw new Error(`New Todo ${id} must include content.`);
    byId.set(id, {
      id,
      content: requireText(entry.content ?? previous?.content ?? "", `Todo ${id} content`),
      status: entry.status ?? previous?.status ?? AgentTodoStatuses.Pending,
      order: previous?.order ?? current.length + seen.size - 1,
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
  }
  return [...byId.values()].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

function normalizeItems(items: readonly AgentTodoItem[]): AgentTodoItem[] {
  const activeIndex = items.findIndex((item) => item.status === AgentTodoStatuses.InProgress);
  const activeCount = items.filter((item) => item.status === AgentTodoStatuses.InProgress).length;
  if (activeCount > 1) throw new Error("Only one Todo may be in_progress.");
  if (activeIndex < 0) return items.map((item, index) => ({ ...item, order: index }));
  const pendingIndex = items.findIndex(
    (item, index) => index < activeIndex && item.status === AgentTodoStatuses.Pending,
  );
  if (pendingIndex < 0) return items.map((item, index) => ({ ...item, order: index }));
  const reordered = [...items];
  const [active] = reordered.splice(activeIndex, 1);
  reordered.splice(pendingIndex, 0, active);
  return reordered.map((item, index) => ({ ...item, order: index }));
}

function validateItems(items: readonly AgentTodoItem[], policy: AgentTodoPolicy): void {
  if (items.length > policy.maxItems) throw new Error(`Todo list exceeds ${policy.maxItems} items.`);
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
