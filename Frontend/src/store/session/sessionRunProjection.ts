import type { RunRecord } from "./types";

export function createRunRecord(input: {
  requestId: string;
  startedAt: string;
  input: string;
  inputAttachments?: RunRecord["inputAttachments"];
}): RunRecord {
  return {
    requestId: input.requestId,
    revision: 0,
    startedAt: input.startedAt,
    status: "running",
    outputState: "pending",
    input: input.input,
    inputAttachments: input.inputAttachments,
    activities: [],
    steps: [],
    streamingRaw: "",
    thinkingBlocks: [],
    xmlPreview: "",
    visibleText: "",
    displayText: "",
    visibleKind: "unknown",
    expectedOutputMode: "unknown",
    decisionMode: "none",
    plannedDecisionMode: undefined,
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

export function isRunTerminal(run: Pick<RunRecord, "status">): boolean {
  return run.status === "completed" || run.status === "failed" || run.status === "cancelled";
}

export function touchRun(run: RunRecord): void {
  run.revision = (run.revision ?? 0) + 1;
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
  // Socket deltas are already coalesced once per animation frame. Rendering
  // that authoritative frame directly avoids a second character-by-character
  // state loop that repeatedly rescanned the unread tail of long responses.
  run.displayText = run.visibleText;
}

export function projectTerminalDisplayText(run: RunRecord, text: string, replayingHistory: boolean): void {
  run.visibleText = text;
  if (replayingHistory) {
    run.displayText = text;
    return;
  }
  alignRunDisplayTarget(run);
}
