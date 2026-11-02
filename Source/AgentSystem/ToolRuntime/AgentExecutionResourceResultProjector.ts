import type {
  AgentExecutionResourceEvent,
  AgentExecutionResourceOwner,
  AgentExecutionResourceSnapshot,
} from "../ExecutionResources/AgentExecutionResourceTypes.js";

export interface AgentExecutionResourceResultProjectionOptions {
  /** Cursor used to obtain this snapshot. It makes omitted output recoverable. */
  readonly fromCursor?: number;
  /** A launch or inventory response may identify the command once. */
  readonly includeInvocation?: boolean;
}

export type AgentExecutionResourceResultUpdate =
  | {
      readonly kind: "output";
      readonly cursor: number;
      readonly stream: "stdout" | "stderr";
      readonly text: string;
      readonly byteLength: number;
      readonly totalBytes: number;
      readonly truncated?: true;
    }
  | {
      readonly kind: "state";
      readonly cursor: number;
      readonly state: AgentExecutionResourceSnapshot["state"];
      readonly reason?: string;
    };

/**
 * Model-facing delta of an execution resource. The broker snapshot remains
 * the complete operational object; this projection deliberately excludes
 * historical command/output copies unless a launch or inventory needs them.
 */
export interface AgentExecutionResourceResultProjection {
  readonly resourceId: string;
  readonly kind: AgentExecutionResourceSnapshot["kind"];
  readonly state: AgentExecutionResourceSnapshot["state"];
  readonly fromCursor: number;
  readonly cursor: number;
  readonly oldestCursor: number;
  readonly historyTruncated?: true;
  readonly updates: readonly AgentExecutionResourceResultUpdate[];
  readonly exitCode?: number | null;
  readonly signal?: NodeJS.Signals | number | null;
  readonly error?: string;
  readonly command?: string;
  readonly cwd?: string;
}

export interface AgentExecutionResourceCollectionProjection {
  readonly resources: readonly AgentExecutionResourceResultProjection[];
}

export function projectAgentExecutionResourceResult(
  snapshot: AgentExecutionResourceSnapshot,
  options: AgentExecutionResourceResultProjectionOptions = {},
): AgentExecutionResourceResultProjection {
  const fromCursor = normalizeCursor(options.fromCursor);
  return {
    resourceId: snapshot.resourceId,
    kind: snapshot.kind,
    state: snapshot.state,
    fromCursor,
    cursor: snapshot.cursor,
    oldestCursor: snapshot.oldestCursor,
    ...(snapshot.truncated ? { historyTruncated: true } : {}),
    updates: snapshot.events.map(projectUpdate),
    ...(snapshot.exitCode === undefined ? {} : { exitCode: snapshot.exitCode }),
    ...(snapshot.signal === undefined ? {} : { signal: snapshot.signal }),
    ...(snapshot.error ? { error: snapshot.error } : {}),
    ...(options.includeInvocation ? { command: snapshot.command, cwd: snapshot.cwd } : {}),
  };
}

export function projectAgentExecutionResourceCollection(
  snapshots: readonly AgentExecutionResourceSnapshot[],
): AgentExecutionResourceCollectionProjection {
  return {
    resources: snapshots.map((snapshot) =>
      projectAgentExecutionResourceResult(snapshot, {
        fromCursor: snapshot.cursor,
        includeInvocation: true,
      }),
    ),
  };
}

export function collectAgentExecutionResourceOutput(snapshot: AgentExecutionResourceSnapshot): {
  stdout: string;
  stderr: string;
  stdoutBytes?: number;
  stderrBytes?: number;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
} {
  const stdout = snapshot.events.filter(isOutputEvent).filter((event) => event.stream === "stdout");
  const stderr = snapshot.events.filter(isOutputEvent).filter((event) => event.stream === "stderr");
  const lastStdout = stdout.at(-1);
  const lastStderr = stderr.at(-1);
  return {
    stdout: stdout.map((event) => event.text).join(""),
    stderr: stderr.map((event) => event.text).join(""),
    ...(lastStdout ? { stdoutBytes: lastStdout.totalBytes } : {}),
    ...(lastStderr ? { stderrBytes: lastStderr.totalBytes } : {}),
    ...(snapshot.truncated || stdout.some((event) => event.truncated) ? { stdoutTruncated: true } : {}),
    ...(snapshot.truncated || stderr.some((event) => event.truncated) ? { stderrTruncated: true } : {}),
  };
}

/**
 * Remembers an acknowledged cursor per stable resource owner. Explicit
 * cursors always win; omitted cursors continue from the last delivered delta.
 */
export class AgentExecutionResourceCursorLedger {
  private readonly cursors = new Map<string, number>();

  resolve(owner: AgentExecutionResourceOwner, resourceId: string, explicitCursor: number | undefined): number {
    return explicitCursor === undefined ? (this.cursors.get(this.key(owner, resourceId)) ?? 0) : explicitCursor;
  }

  record(owner: AgentExecutionResourceOwner, snapshot: AgentExecutionResourceSnapshot): void {
    this.cursors.set(this.key(owner, snapshot.resourceId), snapshot.cursor);
  }

  private key(owner: AgentExecutionResourceOwner, resourceId: string): string {
    return JSON.stringify([owner.workspaceRoot, owner.sessionId ?? owner.requestId ?? null, resourceId]);
  }
}

function projectUpdate(event: AgentExecutionResourceEvent): AgentExecutionResourceResultUpdate {
  return event.kind === "output"
    ? {
        kind: event.kind,
        cursor: event.cursor,
        stream: event.stream,
        text: event.text,
        byteLength: event.byteLength,
        totalBytes: event.totalBytes,
        ...(event.truncated ? { truncated: true } : {}),
      }
    : {
        kind: event.kind,
        cursor: event.cursor,
        state: event.state,
        ...(event.reason ? { reason: event.reason } : {}),
      };
}

function isOutputEvent(
  event: AgentExecutionResourceEvent,
): event is Extract<AgentExecutionResourceEvent, { kind: "output" }> {
  return event.kind === "output";
}

function normalizeCursor(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? 0 : Math.max(0, Math.floor(value));
}
