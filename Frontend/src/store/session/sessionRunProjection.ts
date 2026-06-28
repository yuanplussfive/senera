import { DecisionXmlRoots } from "../../api/eventTypes";
import type { MotionLevel } from "../../shared/motion";
import {
  advanceStreamingDisplayText,
  alignStreamingDisplayTarget,
} from "./streamingDisplay";
import type { RunRecord } from "./types";

type ToolCallStreamClassification =
  | "tool_prefix"
  | "not_tool";

export function createRunRecord(input: {
  requestId: string;
  startedAt: string;
  input: string;
}): RunRecord {
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
    pendingToolArgsByName: {},
  };
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
  if (run.expectedOutputMode === "tool_call_xml") {
    run.decisionMode = "tool_candidate";
    run.visibleText = "";
    run.visibleKind = "tool_calls";
    return;
  }

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

  if (isToolCallStreamPrefix(run.streamingRaw)) {
    run.decisionMode = "tool_candidate";
    run.visibleText = "";
    run.visibleKind = "unknown";
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

export function projectTerminalDisplayText(
  run: RunRecord,
  text: string,
  replayingHistory: boolean,
): void {
  run.visibleText = text;
  if (replayingHistory) {
    run.displayText = text;
    return;
  }
  alignRunDisplayTarget(run);
}

export function isToolCallStreamPrefix(text: string): boolean {
  return classifyToolCallStream(text) === "tool_prefix";
}

function classifyToolCallStream(text: string): ToolCallStreamClassification {
  const body = text.trimStart();
  if (!body.startsWith("<")) return "not_tool";

  const expectedRoot = `<${DecisionXmlRoots.ToolCalls}`.toLowerCase();
  const comparable = body.slice(0, expectedRoot.length).toLowerCase();
  const isPrefixCandidate = comparable.length < expectedRoot.length
    ? expectedRoot.startsWith(comparable)
    : comparable === expectedRoot && isXmlNameBoundary(body[expectedRoot.length]);

  return isPrefixCandidate ? "tool_prefix" : "not_tool";
}

function isXmlNameBoundary(char: string | undefined): boolean {
  return char === undefined || char === ">" || char === "/" || /\s/.test(char);
}
