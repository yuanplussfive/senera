import { describe, expect, test } from "vitest";
import {
  AgentExecutionStatuses,
  AgentExecutionStepStatuses,
  type AgentExecutionLedger,
} from "../../../Source/AgentSystem/Goals/AgentExecutionLedgerTypes.js";
import { renderAgentWorkflowPromptWire } from "../../../Source/AgentSystem/Prompt/AgentPromptContextWireRenderer.js";
import { EmptyAgentWorkflowPromptContext } from "../../../Source/AgentSystem/Prompt/AgentWorkflowPromptContext.js";
import { AgentModelTokenEstimator } from "../../../Source/AgentSystem/Text/AgentTextBudget.js";

const tokenizer = new AgentModelTokenEstimator({ model: "gpt-4o" });
const estimateTokens = (text: string) => tokenizer.estimate(text).tokenCount;

const execution: AgentExecutionLedger = {
  id: "execution-1",
  uri: "senera://execution/execution-1",
  sessionId: "session-1",
  requestId: "request-1",
  objective: "检查时间显示",
  status: AgentExecutionStatuses.Completed,
  createdAt: "2026-10-09T00:00:00Z",
  updatedAt: "2026-10-09T00:05:00Z",
  completedAt: "2026-10-09T00:05:00Z",
  steps: [
    {
      id: "step-1",
      nodeId: "node-1",
      planId: "plan-1",
      planRevision: 1,
      index: 0,
      title: "读取配置",
      detail: "",
      status: AgentExecutionStepStatuses.Completed,
      dependencyIds: [],
      createdAt: "2026-10-09T00:00:00Z",
      updatedAt: "2026-10-09T00:05:00Z",
    },
  ],
};

describe("prompt context wire timestamps", () => {
  test("projects execution ledger timestamps into Shanghai offsets", () => {
    const wire = renderAgentWorkflowPromptWire(
      { ...EmptyAgentWorkflowPromptContext, execution: { active: null, executions: [execution] } },
      { estimateTokens },
    );

    expect(wire.text).toContain("2026-10-09T08:00:00+08:00");
    expect(wire.text).toContain("2026-10-09T08:05:00+08:00");
    expect(wire.text).not.toContain("2026-10-09T00:00:00Z");
    expect(wire.text).not.toContain("2026-10-09T00:05:00Z");
  });
});
