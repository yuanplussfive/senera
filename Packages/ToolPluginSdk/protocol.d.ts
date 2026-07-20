export type ToolOutputStream = "stdout" | "stderr";

export interface ToolOutput {
  stream?: ToolOutputStream;
  text: string;
}

export interface NormalizedToolOutput {
  stream: ToolOutputStream;
  text: string;
  byteLength: number;
}

export interface TaskOutputEventPayload {
  kind: "output";
  output: NormalizedToolOutput;
}

export interface TaskProgressEventPayload {
  kind: "progress";
  progress: {
    completed: number;
    total?: number;
    message?: string;
  };
}

export type TaskEventPayload = TaskOutputEventPayload | TaskProgressEventPayload;

export type StoredTaskEvent = TaskEventPayload & {
  taskId: string;
  cursor: number;
  timestamp: string;
};

export interface TaskEventsPage {
  events: StoredTaskEvent[];
  nextCursor: number;
  hasMore: boolean;
}

export interface TaskEventStore {
  appendTaskEvent(taskId: string, event: TaskEventPayload): Promise<StoredTaskEvent>;
  readTaskEvents(taskId: string, afterCursor?: number, limit?: number): Promise<TaskEventsPage>;
}

export const ToolOutputNotificationMethod: "notifications/senera/tool-output";
export const ToolOutputStreams: readonly ToolOutputStream[];
export const TaskEventCapabilityName: "senera.task-events";
export const TaskEventProtocolVersion: 1;
export const TaskEventNotificationMethod: "notifications/senera/task-event";
export const TaskEventsReadMethod: "senera/tasks/events";
export const TaskEventKinds: readonly ["output", "progress"];
export const TaskEventPageLimit: 256;
export const ToolPluginEnvironmentVariables: Readonly<{
  RemoteJobTools: "SENERA_MCP_REMOTE_JOB_TOOLS";
}>;
export function normalizeToolOutput(output: ToolOutput): NormalizedToolOutput;
