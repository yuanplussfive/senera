import type { MotionLevel } from "../../shared/motion";
import { advanceStreamingDisplayText, alignStreamingDisplayTarget } from "./streamingDisplay";
import type { RunRecord } from "./types";

export function createRunRecord(input: { requestId: string; startedAt: string; input: string }): RunRecord {
  return {
    requestId: input.requestId,
    revision: 0,
    startedAt: input.startedAt,
    status: "running",
    input: input.input,
    steps: [],
    streamingRaw: "",
    xmlPreview: "",
    visibleText: "",
    displayText: "",
    visibleKind: "unknown",
    expectedOutputMode: "unknown",
    decisionMode: "none",
    plannedDecisionMode: undefined,
    pendingToolArgsByName: {},
    approvals: [],
    interactionInputs: [],
  };
}

export function syncRunActiveFlags(run: RunRecord): void {
  const flags: NonNullable<RunRecord["activeFlags"]> = [];
  if (run.approvals?.some((entry) => entry.status === "pending")) flags.push("waiting_for_approval");
  if (run.interactionInputs?.some((entry) => entry.status !== "resolved")) flags.push("waiting_for_input");
  run.activeFlags = flags.length > 0 ? flags : undefined;
}

export function touchRun(run: RunRecord): void {
  run.revision = (run.revision ?? 0) + 1;
}

export function advanceRunDisplayText(run: RunRecord, motionLevel: MotionLevel): boolean {
  const next = advanceStreamingDisplayText(
    {
      displayText: run.displayText,
      targetText: run.visibleText,
    },
    motionLevel,
  );
  if (next.changed) {
    run.displayText = next.displayText;
    touchRun(run);
  }
  return next.pending;
}

export function projectStreamingVisibility(run: RunRecord): void {
  if (run.expectedOutputMode === "final_text") {
    run.decisionMode = "final_text";
    run.visibleText = run.streamingRaw;
    run.visibleKind = "final_answer";
    return;
  }

  if (run.decisionMode === "final_text") {
    run.visibleText = run.streamingRaw;
    run.visibleKind = "final_answer";
    return;
  }

  if (run.decisionMode === "tool_candidate") {
    run.visibleText = run.streamingRaw;
    run.visibleKind = "tool_preface";
    return;
  }

  run.decisionMode = "final_text";
  run.visibleText = run.streamingRaw;
  run.visibleKind = "final_answer";
}

export function alignRunDisplayTarget(run: RunRecord): void {
  const aligned = alignStreamingDisplayTarget({
    displayText: run.displayText,
    targetText: run.visibleText,
  });
  run.displayText = aligned.displayText;
}

export function projectTerminalDisplayText(run: RunRecord, text: string, replayingHistory: boolean): void {
  run.visibleText = text;
  if (replayingHistory) {
    run.displayText = text;
    return;
  }
  alignRunDisplayTarget(run);
}
