import { describe, expect, test } from "vitest";
import { selectAgentSandboxProvider } from "../../../Source/AgentSystem/Sandbox/AgentSandboxProviderSelection.js";

describe("sandbox provider selection", () => {
  test("locks Linux auto selection to the first provider whose declared capabilities are available", () => {
    expect(
      selectAgentSandboxProvider({
        preference: "auto",
        platform: "linux",
        capabilities: { dockerEngine: true, registeredDockerRuntimes: ["runc", "runsc"] },
      }),
    ).toBe("gvisor");
    expect(
      selectAgentSandboxProvider({
        preference: "auto",
        platform: "linux",
        capabilities: { dockerEngine: true, registeredDockerRuntimes: ["runc"] },
      }),
    ).toBe("docker-engine");
  });

  test("does not invent a Docker provider before host capabilities have been probed", () => {
    expect(selectAgentSandboxProvider({ preference: "auto", platform: "win32" })).toBeUndefined();
    expect(selectAgentSandboxProvider({ preference: "auto", platform: "darwin" })).toBeUndefined();
  });

  test("rejects an explicitly selected provider when probed capabilities prove it unavailable", () => {
    expect(() =>
      selectAgentSandboxProvider({
        preference: "gvisor",
        platform: "linux",
        capabilities: { dockerEngine: true, registeredDockerRuntimes: ["runc"] },
      }),
    ).toThrow("registered-runsc");
    expect(() =>
      selectAgentSandboxProvider({
        preference: "docker-engine",
        platform: "linux",
        capabilities: { dockerEngine: false, registeredDockerRuntimes: [] },
      }),
    ).toThrow("docker-engine");
  });
});
