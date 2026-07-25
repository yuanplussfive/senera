import { describe, expect, test } from "vitest";
import {
  AgentGvisorRuntimeContractSchema,
  readAgentDockerEngineRuntimeContract,
  readAgentGvisorRuntimeContract,
  readAgentGvisorRuntimePolicyContract,
} from "../../../Source/AgentSystem/Sandbox/Gvisor/AgentGvisorRuntimeContract.js";

describe("gVisor runtime contract", () => {
  test("binds the OCI policy to the immutable sandbox distribution image", () => {
    const resolved = readAgentGvisorRuntimeContract("x64");
    expect(resolved.contract).toMatchObject({
      formatVersion: 1,
      provider: "gvisor",
      runtime: { platform: "linux" },
      container: {
        readOnlyRootFilesystem: true,
        init: true,
        dropCapabilities: ["ALL"],
      },
    });
    expect(resolved.image.sourceImage).toMatch(/@sha256:[a-f0-9]{64}$/u);
    expect(resolved.contract.guest.shell.command).toMatch(/^\//u);
  });

  test("rejects undeclared policy keys and relative guest paths", () => {
    const contract = readAgentGvisorRuntimePolicyContract();
    expect(AgentGvisorRuntimeContractSchema.safeParse({ ...contract, undeclared: true }).success).toBe(false);
    expect(
      AgentGvisorRuntimeContractSchema.safeParse({
        ...contract,
        guest: { ...contract.guest, workspaceRoot: "workspace" },
      }).success,
    ).toBe(false);
  });

  test("composes both providers from one shared hardened Docker policy", () => {
    const gvisor = readAgentDockerEngineRuntimeContract("gvisor", "x64").contract;
    const dockerEngine = readAgentDockerEngineRuntimeContract("docker-engine", "x64").contract;

    expect(gvisor.runtime).toEqual({ strategy: "registered", name: "runsc", platform: "linux" });
    expect(dockerEngine.runtime).toEqual({ strategy: "daemon-default", platform: "linux" });
    expect(dockerEngine.container).toMatchObject({
      readOnlyRootFilesystem: true,
      init: true,
      securityOptions: ["no-new-privileges:true"],
      dropCapabilities: ["ALL"],
    });
    expect(dockerEngine.defaults).toEqual({
      cpuCount: 2,
      memoryMiB: 1024,
      processCount: 256,
      network: "default",
    });
    expect(gvisor.defaults).toEqual(dockerEngine.defaults);
    expect({ ...gvisor.container, labels: undefined }).toEqual({ ...dockerEngine.container, labels: undefined });
  });
});
