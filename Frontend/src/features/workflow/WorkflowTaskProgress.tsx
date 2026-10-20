import type { TodoData } from "../../api/continuityExecutionEventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import type { RunRecord, TimelineChildRunTodoItem } from "../../store/sessionStore";
import { ActivityStatusIcon, AppIcon } from "../../shared/ui";

interface TaskItem {
  readonly content: string;
  readonly status: TodoData["status"];
}

interface TaskGroup {
  readonly id: string;
  readonly owner?: string;
  readonly items: readonly TaskItem[];
}

export function WorkflowTaskProgress({ run }: { run: RunRecord }): JSX.Element | null {
  const groups = readTaskGroups(run);
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
      <div className="workflow-task-progress__list " data-workflow-task-progress-list>
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

function readTaskGroups(run: RunRecord): TaskGroup[] {
  const rootItems = run.todos?.items ?? [];
  const groups: TaskGroup[] = rootItems.length > 0 ? [{ id: "root", items: rootItems }] : [];
  const childGroups = new Map<string, TaskGroup>();

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

function TaskProgressRow({ item }: { item: TaskItem | TimelineChildRunTodoItem }): JSX.Element {
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
