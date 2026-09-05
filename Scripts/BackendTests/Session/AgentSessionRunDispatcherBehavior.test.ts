import { describe, expect, test, vi } from "vitest";
import { AgentCancellationError } from "../../../Source/AgentSystem/Core/AgentCancellation.js";
import { AgentRunContextModes } from "../../../Source/AgentSystem/Orchestration/AgentRunDispatchPort.js";
import { AgentExecutionApprovalModes } from "../../../Source/AgentSystem/Safety/AgentExecutionApprovalMode.js";
import { AgentSessionRunDispatcher } from "../../../Source/AgentSystem/Session/AgentSessionRunDispatcher.js";

describe("agent session run dispatcher", () => {
  test("keeps dispatch pending until a cancelled session turn really settles", async () => {
    let settleSubmission!: () => void;
    const submission = new Promise<{ kind: "accepted" }>((resolve) => {
      settleSubmission = () => resolve({ kind: "accepted" });
    });
    const sessions = {
      forkSession: vi.fn(async () => undefined),
      submitMessage: vi.fn(() => submission),
      requestActiveRunCancellation: vi.fn(async () => true),
      settleActiveRunCancellation: vi.fn(async () => true),
      requestActiveRunFinalAnswer: vi.fn(async () => true),
      steerActiveRun: vi.fn(async () => true),
      followUpActiveRun: vi.fn(async () => true),
      interruptActiveRun: vi.fn(async () => true),
    };
    const dispatcher = new AgentSessionRunDispatcher(sessions);
    const controller = new AbortController();
    const dispatch = dispatcher.dispatch({
      sessionId: "child-session",
      requestId: "child-request",
      input: "Inspect the assigned scope.",
      approvalMode: AgentExecutionApprovalModes.Agent,
      contextMode: AgentRunContextModes.Fresh,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(sessions.submitMessage).toHaveBeenCalledOnce());

    controller.abort(new AgentCancellationError("Parent stopped the child run."));

    await vi.waitFor(() => expect(sessions.requestActiveRunCancellation).toHaveBeenCalledOnce());
    let settled = false;
    void dispatch.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);

    settleSubmission();
    await expect(dispatch).rejects.toMatchObject({
      name: "AgentCancellationError",
      message: "Parent stopped the child run.",
    });
    expect(sessions.requestActiveRunCancellation).toHaveBeenCalledWith({
      sessionId: "child-session",
      onEvent: expect.any(Function),
    });
    expect(sessions.settleActiveRunCancellation).not.toHaveBeenCalled();
  });
});
