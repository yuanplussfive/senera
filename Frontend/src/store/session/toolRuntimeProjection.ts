import type { ToolCallOutputData, ToolCallProgressData } from "../../api/eventTypes";
import type { TimelineStep, TimelineToolOutput } from "../sessionStore";

const MaxStreamCharacters = 128 * 1024;
const TruncationMarker = "... earlier tool output omitted ...\n";

export function projectToolOutput(step: TimelineStep, data: ToolCallOutputData): void {
  const output: TimelineToolOutput = step.toolOutput ?? {
    stdout: "",
    stderr: "",
    stdoutBytes: 0,
    stderrBytes: 0,
    lastSequence: 0,
    truncated: false,
  };
  if (data.outputSequence <= output.lastSequence) return;

  const field = data.stream;
  const bytesField = `${field}Bytes` as const;
  const appended = appendBounded(output[field], data.text);
  output[field] = appended.value;
  output[bytesField] = Math.max(output[bytesField], data.totalBytes);
  output.lastSequence = data.outputSequence;
  output.truncated ||= appended.truncated;
  step.toolOutput = output;

  const preview = lastNonEmptyLine(data.text);
  if (preview) step.description = preview;
}

export function projectToolProgress(step: TimelineStep, data: ToolCallProgressData): void {
  if (data.progressSequence <= (step.toolProgress?.sequence ?? 0)) return;
  step.toolProgress = {
    sequence: data.progressSequence,
    message: data.message,
    completed: data.completed,
    total: data.total,
    unit: data.unit,
    taskId: data.taskId,
    state: data.state,
    terminal: data.terminal,
    pollIntervalMs: data.pollIntervalMs,
  };
  if (data.message) step.description = data.message;
}

function appendBounded(current: string, chunk: string): { value: string; truncated: boolean } {
  const combined = `${current}${chunk}`;
  if (combined.length <= MaxStreamCharacters) return { value: combined, truncated: false };
  const tailLength = MaxStreamCharacters - TruncationMarker.length;
  return {
    value: `${TruncationMarker}${combined.slice(-tailLength)}`,
    truncated: true,
  };
}

function lastNonEmptyLine(value: string): string | undefined {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
    ?.slice(0, 180);
}
