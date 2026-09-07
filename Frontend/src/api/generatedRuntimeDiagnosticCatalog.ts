// Generated from backend event observation contracts.
// Run `npm run generate.frontend-events` after editing those contracts.

import type { EventKind } from "./generatedEventCatalog";

interface EventDiagnosticSpecBase {
  readonly source: "activity" | "tool";
  readonly idPointer: string;
  readonly labelPointer: string;
  readonly startedAtPointer: string;
  readonly durationMsPointer: string;
}

export type EventDiagnosticSpec =
  | (EventDiagnosticSpecBase & {
      readonly statePointer: string;
      readonly fixedState?: never;
    })
  | (EventDiagnosticSpecBase & {
      readonly statePointer?: never;
      readonly fixedState: "started" | "completed" | "failed";
    });

export const RuntimeDiagnosticSpecs = {
  "run.activity.changed": {
    source: "activity",
    idPointer: "/data/activityId",
    labelPointer: "/data/activity",
    statePointer: "/data/state",
    startedAtPointer: "/data/startedAt",
    durationMsPointer: "/data/durationMs",
  },
  "tool.call.started": {
    source: "tool",
    idPointer: "/data/callId",
    labelPointer: "/data/toolName",
    fixedState: "started",
    startedAtPointer: "/data/startedAt",
    durationMsPointer: "/data/durationMs",
  },
  "tool.call.completed": {
    source: "tool",
    idPointer: "/data/callId",
    labelPointer: "/data/toolName",
    fixedState: "completed",
    startedAtPointer: "/data/startedAt",
    durationMsPointer: "/data/durationMs",
  },
  "tool.call.failed": {
    source: "tool",
    idPointer: "/data/callId",
    labelPointer: "/data/toolName",
    fixedState: "failed",
    startedAtPointer: "/data/startedAt",
    durationMsPointer: "/data/durationMs",
  },
} as const satisfies Partial<Record<EventKind, EventDiagnosticSpec>>;
