export function createSession(runs) {
  return {
    sessionId: "session-a",
    title: "Workflow session",
    status: "ready",
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:02.000Z",
    entryCount: 2,
    messageCount: 2,
    messages: [],
    runs,
  };
}

export function createRun(overrides = {}) {
  return {
    requestId: "run-a",
    revision: 0,
    startedAt: "2026-07-11T00:00:00.000Z",
    endedAt: "2026-07-11T00:00:02.000Z",
    status: "completed",
    input: "run input",
    steps: [createStep()],
    streamingRaw: "",
    xmlPreview: "",
    visibleText: "",
    displayText: "",
    displayTarget: "",
    displayedChars: 0,
    expectedOutputMode: "open",
    ...overrides,
  };
}

export function createStep(overrides = {}) {
  return {
    id: "step-a",
    kind: "decision",
    title: "Decision step",
    status: "done",
    startedAt: "2026-07-11T00:00:00.000Z",
    ...overrides,
  };
}

export function createToolBatchRun(toolNames) {
  const toolBatch = { id: "batch-actions", size: toolNames.length, executionMode: "parallel" };
  return createRun({
    requestId: "run-action-batch",
    status: "running",
    endedAt: undefined,
    steps: [
      createStep({
        id: "batch-preface",
        kind: "decision",
        title: "Preface before tool calls",
        description: "我先检查这一批工作区文件。",
        status: "done",
        decisionKind: "tool_preface",
        toolBatch,
      }),
      createStep({
        id: "batch-plan",
        kind: "tool",
        title: "Prepare action batch",
        status: "done",
        toolBatch,
      }),
      ...toolNames.map((toolName, index) =>
        createStep({
          id: `tool-${index}`,
          kind: "tool",
          title: `Call ${toolName}`,
          status: "done",
          toolName,
          callId: `call-${index}`,
          toolBatch: { ...toolBatch, index },
        }),
      ),
      createStep({
        id: "compose-answer",
        kind: "model",
        title: "Compose answer",
        status: "running",
      }),
    ],
  });
}

export function workflowNodeLayout(direction, width = 240, height = 76) {
  return { direction, width, height };
}

export function workflowNodeData(direction, width, height) {
  return {
    layout: workflowNodeLayout(direction, width, height),
    kind: "step",
    step: createStep(),
  };
}

export function viewportNode(id, data) {
  return {
    id,
    type: "step",
    position: { x: 0, y: 0 },
    data: { layout: workflowNodeLayout("vertical"), ...data },
  };
}
