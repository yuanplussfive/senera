import { Check, Circle, X } from "lucide-react";
import type { TodoData } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { Spinner } from "../../shared/ui";
import { cn } from "../../lib/util";
import type { RunRecord } from "../../store/sessionStore";

/**
 * Live task-list card pinned above the composer. Width matches the assistant
 * bubble column; the snapshot projects from TodoListWritten onto the live run
 * so every status change re-renders without polling.
 */
export function TodoProgressCard({ run }: { run: RunRecord | undefined }): JSX.Element | null {
  const todos = run?.todos;
  if (!todos || todos.items.length === 0) return null;
  if (run?.status === "failed" || run?.status === "cancelled") return null;

  const activeCount = todos.items.filter((item) => item.status === "pending" || item.status === "in_progress").length;

  return (
    <div
      className="max-w-[440px] overflow-hidden rounded-lg border border-line bg-surface-raised shadow-panel"
      data-todo-progress
      data-testid="todo-progress-card"
    >
      <header className="flex items-baseline justify-between gap-3 border-b border-line-subtle px-3 py-2">
        <span className="text-[11px] font-medium text-content-secondary">
          {frontendMessage("chat.todoProgress.title")}
        </span>
        <span className="shrink-0 text-[10px] tabular-nums text-content-muted">
          {activeCount > 0
            ? frontendMessage("chat.todoProgress.activeRemaining", { active: activeCount })
            : frontendMessage("chat.todoProgress.doneSummary", {
                done: todos.counts.completed,
                total: todos.counts.total,
              })}
        </span>
      </header>
      <ul className="px-1.5 py-1">
        {todos.items.map((item) => (
          <TodoRow key={item.id} item={item} />
        ))}
      </ul>
    </div>
  );
}

function TodoRow({ item }: { item: TodoData }): JSX.Element {
  return (
    <li
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1",
        item.status === "completed" && "opacity-60",
        item.status === "cancelled" && "opacity-40",
      )}
      data-todo-item={item.status}
    >
      <TodoStatusIcon status={item.status} />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[12px] leading-5",
          item.status === "completed"
            ? "text-content-disabled line-through"
            : item.status === "cancelled"
              ? "text-content-disabled line-through"
              : "text-content-secondary",
        )}
        title={item.content}
      >
        {item.content}
      </span>
    </li>
  );
}

function TodoStatusIcon({ status }: { status: TodoData["status"] }): JSX.Element {
  switch (status) {
    case "in_progress":
      return <Spinner size="sm" aria-hidden="true" />;
    case "completed":
      return <Check className="h-3 w-3 shrink-0 text-moss-600" aria-hidden="true" />;
    case "cancelled":
      return <X className="h-3 w-3 shrink-0 text-brick-500" aria-hidden="true" />;
    default:
      return <Circle className="h-3 w-3 shrink-0 text-ink-300" aria-hidden="true" />;
  }
}
