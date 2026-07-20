"use strict";

const ToolOutputNotificationMethod = "notifications/senera/tool-output";
const ToolOutputStreams = Object.freeze(["stdout", "stderr"]);
const TaskEventCapabilityName = "senera.task-events";
const TaskEventProtocolVersion = 1;
const TaskEventNotificationMethod = "notifications/senera/task-event";
const TaskEventsReadMethod = "senera/tasks/events";
const TaskEventKinds = Object.freeze(["output", "progress"]);
const TaskEventPageLimit = 256;
const ToolPluginEnvironmentVariables = Object.freeze({
  RemoteJobTools: "SENERA_MCP_REMOTE_JOB_TOOLS",
});

function normalizeToolOutput(output) {
  const value = output && typeof output === "object" && !Array.isArray(output) ? output : {};
  const stream = value.stream ?? "stdout";
  if (!ToolOutputStreams.includes(stream)) {
    throw new TypeError(`Tool output stream must be one of: ${ToolOutputStreams.join(", ")}.`);
  }
  if (typeof value.text !== "string") {
    throw new TypeError("Tool output text must be a string.");
  }
  return {
    stream,
    text: value.text,
    byteLength: Buffer.byteLength(value.text, "utf8"),
  };
}

module.exports = {
  ToolOutputNotificationMethod,
  ToolOutputStreams,
  TaskEventCapabilityName,
  TaskEventProtocolVersion,
  TaskEventNotificationMethod,
  TaskEventsReadMethod,
  TaskEventKinds,
  TaskEventPageLimit,
  ToolPluginEnvironmentVariables,
  normalizeToolOutput,
};
