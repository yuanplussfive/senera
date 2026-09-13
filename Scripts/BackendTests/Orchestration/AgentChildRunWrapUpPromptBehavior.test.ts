import { describe, expect, test } from "vitest";
import { renderAgentChildRunWrapUpInstruction } from "../../../Source/AgentSystem/Orchestration/AgentChildRunWrapUpPrompt.js";
import { renderSupervisorResponsePrompt } from "../../../Source/AgentSystem/Orchestration/AgentDelegationRuntimeSupport.js";

describe("child-run wrap-up prompt", () => {
  test("projects remaining Todo items through the shared wire", () => {
    const prompt = renderAgentChildRunWrapUpInstruction({
      reason: "no_progress",
      remainingTodo: [{ id: "todo-1", content: "继续检查", status: "pending" }],
    });

    expect(prompt).toContain("senera.child_run_wrap_up=v1");
    expect(prompt).toContain("[senera.remaining_todos]");
    expect(prompt).toContain("继续检查");
    expect(prompt).not.toContain('{"content":"继续检查","id":"todo-1","status":"pending"}');
  });

  test("hands a resumed child the durable checkpoint coordinates", () => {
    const prompt = renderSupervisorResponsePrompt("继续完成剩余工作", {
      version: 1,
      capturedAt: "2026-09-12T00:00:00.000Z",
      source: "model_stream",
      content: "已完成源码检查，等待修复验证。",
      complete: false,
      continuity: {
        id: "checkpoint:resume",
        revision: "revision-1",
        capturedAt: "2026-09-12T00:00:00.000Z",
        referenceIds: ["senera://work-item/work-1"],
        workspaceRevision: "sha256:workspace",
        resume: { status: "running" },
      },
    });

    expect(prompt).toContain("senera.child_run_resume=v1");
    expect(prompt).toContain("revision-1");
    expect(prompt).toContain("sha256:workspace");
    expect(prompt).toContain("已完成源码检查");
    expect(prompt).not.toContain('"provenance":"user"');
  });
});
