import type { TodoData, TodoSnapshotData } from "../../api/continuityExecutionEventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import type { RunRecord } from "../../store/sessionStore";
import { ActivityStatusIcon, AppIcon } from "../../shared/ui";

export interface WorkflowTaskItem {
  readonly content: string;
  readonly status: TodoData["status"];
}

export interface WorkflowTaskGroup {
  readonly id: string;
  /** Agent that owns this list; absent for the session's own list. */
  readonly owner?: string;
  readonly items: readonly WorkflowTaskItem[];
}

/** The session's standing list, as one group. */
export function readTodoTaskGroups(todos: TodoSnapshotData | undefined): WorkflowTaskGroup[] {
  const items = todos?.items ?? [];
  return items.length > 0 ? [{ id: "root", items }] : [];
}

/** The run's own list plus every delegated agent's list, in step order. */
export function readRunTaskGroups(run: RunRecord): WorkflowTaskGroup[] {
  const groups = readTodoTaskGroups(run.todos);
  const childGroups = new Map<string, WorkflowTaskGroup>();

  for (const step of run.steps) {
    const childRun = step.childRun;
    const items = childRun?.todo?.items;
    if (!childRun || !items?.length || childGroups.has(childRun.id)) continue;
    const owner = step.scope?.agentName;
    childGroups.set(childRun.id, {
      id: childRun.id,
      ...(owner ? { owner } : {}),
      items,
    });
  }

  groups.push(...childGroups.values());
  return groups;
}

export function WorkflowTaskProgress({ groups }: { groups: readonly WorkflowTaskGroup[] }): JSX.Element | null {
  const items = groups.flatMap((group) => group.items);
  if (items.length === 0) return null;

  const completed = items.filter((item) => item.status === "completed").length;
  const completionRatio = items.length > 0 ? completed / items.length : 0;

  return (
    <section
      className="workflow-task-progress"
      aria-label={frontendMessage("chat.todoProgress.title")}
      data-workflow-task-progress
    >
      <header className="workflow-section-header" data-workflow-task-progress-header>
        <span className="activity-feed-row__icon workflow-section-header__icon" aria-hidden="true">
          <AppIcon icon="list-tree" size={15} />
        </span>
        <span className="workflow-section-header__title">{frontendMessage("chat.todoProgress.title")}</span>
        <span className="workflow-section-header__meta">
          {frontendMessage("chat.todoProgress.doneSummary", { done: completed, total: items.length })}
        </span>
      </header>
      <div
        className="workflow-task-progress__bar"
        role="progressbar"
        aria-label={frontendMessage("chat.todoProgress.doneSummary", { done: completed, total: items.length })}
        aria-valuemin={0}
        aria-valuemax={items.length}
        aria-valuenow={completed}
        data-workflow-task-progress-bar
      >
        <span style={{ width: `${completionRatio * 100}%` }} />
      </div>
      <div className="workflow-task-progress__list" data-workflow-task-progress-list>
        {groups.map((group) => (
          <div key={group.id} className="workflow-task-progress__group" data-workflow-task-group={group.id}>
            {group.owner ? <div className="workflow-task-progress__owner">{group.owner}</div> : null}
            <ul className="workflow-task-progress__items" role="list">
              {group.items.map((item, index) => (
                <TaskProgressRow key={`${group.id}:${index}`} item={item} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function TaskProgressRow({ item }: { item: WorkflowTaskItem }): JSX.Element {
  const active = item.status === "in_progress";
  return (
    <li
      className={cn("workflow-task-progress__row", active && "workflow-task-progress__row--active")}
      data-todo-item={item.status}
      data-workflow-task-item
    >
      <TaskStatusIcon status={item.status} />
      <span
        className={cn(
          "activity-feed-row__content workflow-task-progress__label",
          (item.status === "completed" || item.status === "cancelled") && "text-content-muted",
        )}
        title={item.content}
      >
        {item.content}
      </span>
    </li>
  );
}

function TaskStatusIcon({ status }: { status: TodoData["status"] }): JSX.Element {
  const activityStatus =
    status === "in_progress"
      ? "running"
      : status === "completed"
        ? "completed"
        : status === "cancelled"
          ? "cancelled"
          : "pending";
  return (
    <ActivityStatusIcon
      status={activityStatus}
      motion="spin"
      size={15}
      className="activity-feed-row__icon workflow-task-progress__status-icon"
    />
  );
}
