import { describe, expect, test } from "vitest";
import { selectAgentSandboxProvider } from "../../../Source/AgentSystem/Sandbox/AgentSandboxProviderSelection.js";

describe("sandbox provider selection", () => {
  test("locks Linux auto selection to the first provider whose declared capabilities are available", () => {
    expect(
      selectAgentSandboxProvider({
        preference: "auto",
        platform: "linux",
        microsandboxHostAvailable: () => true,
      }),
    ).toBe("microsandbox");
    expect(
      selectAgentSandboxProvider({
        preference: "auto",
        platform: "linux",
        microsandboxHostAvailable: () => false,
        capabilities: { dockerEngine: true, registeredDockerRuntimes: ["runc", "runsc"] },
      }),
    ).toBe("gvisor");
    expect(
      selectAgentSandboxProvider({
        preference: "auto",
        platform: "linux",
        microsandboxHostAvailable: () => false,
        capabilities: { dockerEngine: true, registeredDockerRuntimes: ["runc"] },
      }),
    ).toBe("docker-engine");
  });

  test("keeps desktop platforms on microsandbox and rejects an explicit gVisor selection", () => {
    expect(selectAgentSandboxProvider({ preference: "auto", platform: "win32" })).toBe("microsandbox");
    expect(() => selectAgentSandboxProvider({ preference: "gvisor", platform: "darwin" })).toThrow("requires linux");
  });

  test("rejects an explicitly selected provider when probed capabilities prove it unavailable", () => {
    expect(() =>
      selectAgentSandboxProvider({
        preference: "gvisor",
        platform: "linux",
        capabilities: { dockerEngine: true, registeredDockerRuntimes: ["runc"] },
        microsandboxHostAvailable: () => false,
      }),
    ).toThrow("registered-runsc");
    expect(() =>
      selectAgentSandboxProvider({
        preference: "docker-engine",
        platform: "linux",
        capabilities: { dockerEngine: false, registeredDockerRuntimes: [] },
        microsandboxHostAvailable: () => false,
      }),
    ).toThrow("docker-engine");
  });
});
