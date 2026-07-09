import {
  AgentTerminalActivityTone,
  type AgentTerminalActivityGroup,
  type AgentTerminalActivityView,
  type AgentTerminalPreviewView,
  type AgentTerminalTimelinePatch,
  type AgentTerminalTimelineViewState,
} from "./AgentTerminalActivity.js";
import { AgentConsoleTheme } from "./AgentConsoleTheme.js";
import { fitTerminalLine } from "../Text/AgentTerminalText.js";

const ActivityIcons: Record<AgentTerminalActivityTone, string> = {
  progress: "•",
  success: "✓",
  warning: "!",
  error: "×",
  neutral: "·",
};

export class AgentTerminalTimelineRenderer {
  private committedLines: string[] = [];

  createState(): AgentTerminalTimelineViewState {
    return {
      groups: new Map<string, AgentTerminalActivityGroup>(),
      activities: new Map<string, AgentTerminalActivityView>(),
      activityOrder: [],
      decisionXmlByStep: new Map<number, string>(),
    };
  }

  applyPatch(
    state: AgentTerminalTimelineViewState,
    patch: AgentTerminalTimelinePatch,
  ): AgentTerminalTimelineViewState {
    patch.groups?.forEach((group) => {
      state.groups.set(group.key, group);
    });

    patch.upserts?.forEach((activity) => {
      state.activities.set(activity.key, activity);
      if (!state.activityOrder.includes(activity.key)) {
        state.activityOrder.push(activity.key);
      }
    });

    patch.removes?.forEach((key) => {
      state.activities.delete(key);
      state.activityOrder.splice(state.activityOrder.indexOf(key), 1);
    });

    if (patch.clearPreview) {
      delete (state as { preview?: AgentTerminalPreviewView }).preview;
    }

    if (patch.preview) {
      (state as { preview?: AgentTerminalPreviewView }).preview = patch.preview;
    }

    return state;
  }

  render(state: AgentTerminalTimelineViewState): string[] {
    const groupedActivities = this.groupedActivities(state);
    const lines = groupedActivities.flatMap(([group, activities]) => this.renderGroup(group, activities));
    return state.preview ? [...lines, ...this.renderPreview(state.preview)] : lines;
  }

  renderWithHistory(state: AgentTerminalTimelineViewState): string[] {
    const current = this.render(state);
    return this.committedLines.length > 0
      ? [...this.committedLines, "", ...current]
      : current;
  }

  commit(state: AgentTerminalTimelineViewState): string[] {
    const current = this.render(state);
    this.committedLines = this.committedLines.length > 0
      ? [...this.committedLines, "", ...current]
      : [...current];
    return this.committedLines;
  }

  resetActiveState(state: AgentTerminalTimelineViewState): AgentTerminalTimelineViewState {
    state.groups.clear();
    state.activities.clear();
    state.activityOrder.splice(0, state.activityOrder.length);
    state.decisionXmlByStep.clear();
    delete (state as { preview?: AgentTerminalPreviewView }).preview;
    return state;
  }

  private groupedActivities(
    state: AgentTerminalTimelineViewState,
  ): Array<[AgentTerminalActivityGroup | undefined, AgentTerminalActivityView[]]> {
    const buckets = new Map<string, AgentTerminalActivityView[]>();
    const ungrouped: AgentTerminalActivityView[] = [];

    state.activityOrder
      .map((key) => state.activities.get(key))
      .filter((entry): entry is AgentTerminalActivityView => Boolean(entry))
      .forEach((activity) => {
        if (!activity.groupKey) {
          ungrouped.push(activity);
          return;
        }

        const bucket = buckets.get(activity.groupKey) ?? [];
        bucket.push(activity);
        buckets.set(activity.groupKey, bucket);
      });

    const grouped = Array.from(buckets.entries()).map(([groupKey, activities]) => [
      state.groups.get(groupKey),
      activities,
    ] as [AgentTerminalActivityGroup | undefined, AgentTerminalActivityView[]]);

    return [
      ...grouped,
      ...(ungrouped.length > 0 ? [[undefined, ungrouped] as [undefined, AgentTerminalActivityView[]]] : []),
    ];
  }

  private renderGroup(
    group: AgentTerminalActivityGroup | undefined,
    activities: AgentTerminalActivityView[],
  ): string[] {
    return [
      ...(group ? [this.renderGroupHeader(group)] : []),
      ...activities.flatMap((activity) => this.renderActivity(activity)),
    ];
  }

  private renderGroupHeader(group: AgentTerminalActivityGroup): string {
    const summary = group.summary ? AgentConsoleTheme.dim(`  ${group.summary}`) : "";
    return `${AgentConsoleTheme.brand("▌")} ${AgentConsoleTheme.label(group.title)}${summary}`;
  }

  private renderActivity(activity: AgentTerminalActivityView): string[] {
    const prefix = this.color(activity.tone)(ActivityIcons[activity.tone]);
    const title = AgentConsoleTheme.label(activity.title);
    const summary = activity.summary ? AgentConsoleTheme.dim(`  ${activity.summary}`) : "";
    const detailLines = this.renderDetail(activity.detail);

    return [
      `${prefix} ${title}${summary}`,
      ...detailLines.map((detail) => `${AgentConsoleTheme.muted("  └")} ${detail}`),
    ];
  }

  private renderPreview(preview: AgentTerminalPreviewView): string[] {
    const color = this.color(preview.tone);
    return [
      `${color("XML 预览")} ${AgentConsoleTheme.dim(preview.summary)}`,
      ...preview.body.map((line) => `${color("│")} ${fitTerminalLine(line, this.previewWidth())}`),
    ];
  }

  private renderDetail(detail: unknown): string[] {
    if (detail === undefined || detail === null) {
      return [];
    }

    if (typeof detail === "string") {
      return detail.split(/\r?\n/);
    }

    if (Array.isArray(detail)) {
      return detail.map((entry) => this.inlineValue(entry));
    }

    if (typeof detail === "object") {
      return Object.entries(detail as Record<string, unknown>).map(
        ([key, value]) => `${key}: ${this.inlineValue(value)}`,
      );
    }

    return [this.inlineValue(detail)];
  }

  private inlineValue(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }

    if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
      return String(value);
    }

    if (value === null) {
      return "null";
    }

    if (Array.isArray(value)) {
      return `${value.length} 项`;
    }

    if (value && typeof value === "object") {
      return "结构";
    }

    return "未定义";
  }

  private previewWidth(): number {
    return Math.max((process.stdout.columns ?? 120) - 6, 36);
  }

  private color(tone: AgentTerminalActivityTone): (value: string) => string {
    return ({
      progress: AgentConsoleTheme.accent,
      success: AgentConsoleTheme.success,
      warning: AgentConsoleTheme.warning,
      error: AgentConsoleTheme.error,
      neutral: AgentConsoleTheme.muted,
    })[tone];
  }
}
