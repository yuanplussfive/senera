import { describe, expect, test, vi } from "vitest";
import { AgentPiCodingAgentSession } from "../../../Source/AgentSystem/Pi/AgentPiCodingAgentSession.js";
import { AgentPiMutableSessionFrame } from "../../../Source/AgentSystem/Pi/AgentPiCodingAgentSessionFrame.js";
import { emptyAgentToolAccessGrant } from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";

describe("Pi coding agent session", () => {
  test("delegates compaction decisions to the native Pi prompt lifecycle", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const compact = vi.fn().mockResolvedValue(undefined);
    const refreshContext = vi.fn();
    const session = new AgentPiCodingAgentSession(
      {
        messages: [],
        prompt,
        compact,
        refreshContext,
        waitForIdle: vi.fn().mockResolvedValue(undefined),
      } as never,
      {} as never,
      createFrame(),
      vi.fn(),
    );

    await session.prompt("hello");

    expect(prompt).toHaveBeenCalledOnce();
    expect(refreshContext).toHaveBeenCalledOnce();
    expect(compact).not.toHaveBeenCalled();
  });
});

function createFrame(): AgentPiMutableSessionFrame {
  const grant = emptyAgentToolAccessGrant();
  return new AgentPiMutableSessionFrame({
    sessionId: "native-compaction-session",
    requestId: "native-compaction-request",
    step: 1,
    skillCatalog: { skills: [], fingerprint: "test" },
    nativeProviderToolNames: [],
    toolAccessGrant: grant,
    toolExposure: new AgentToolExposureState(grant),
    selectedPromptTemplates: [],
    preflight: async () => undefined,
  });
}
