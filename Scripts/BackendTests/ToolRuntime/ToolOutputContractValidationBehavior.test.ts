import { describe, expect, test } from "vitest";
import { SeneraLocalExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import { AgentToolHostCapabilityRegistry } from "../../../Source/AgentSystem/ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { toolProcessSuccessResult } from "../../../Source/AgentSystem/ToolRuntime/AgentToolProcessEnvelope.js";
import { AgentToolRunner } from "../../../Source/AgentSystem/ToolRuntime/AgentToolRunner.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import {
  AgentExecutionErrorCodes,
  AgentToolProcessErrorPhases,
} from "../../../Source/AgentSystem/Xml/AgentXmlStatus.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

describe("Tool output contract validation", () => {
  test("converts an invalid successful result into a structured response-validation failure", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-output-contract");
    const tool = registeredTool(workspaceRoot);
    const capabilities = new AgentToolHostCapabilityRegistry().register("test.output", async () =>
      toolProcessSuccessResult({ answer: null }),
    );
    const runner = new AgentToolRunner(
      {} as AgentSystemConfig,
      workspaceRoot,
      capabilities,
      { getTool: () => tool },
      new SeneraLocalExecutionEnv({ workspaceRoot }),
    );

    try {
      const result = await runner.run(tool, {});
      expect(result.response).toMatchObject({
        ok: false,
        error: {
          code: AgentExecutionErrorCodes.ToolResultSchemaInvalid,
          details: {
            phase: AgentToolProcessErrorPhases.ResponseValidation,
            toolName: "OutputContractTool",
            issues: expect.arrayContaining([expect.stringContaining("answer")]),
          },
        },
      });
    } finally {
      await runner.close();
      removeDirectory(workspaceRoot);
    }
  });
});

function registeredTool(workspaceRoot: string): RegisteredTool {
  const owner: RegisteredTool["owner"] = {
    kind: "system",
    name: "output-contract",
    rootPath: workspaceRoot,
    revision: "test",
    trusted: true,
    requiresApproval: false,
  };
  return {
    owner,
    name: "OutputContractTool",
    loading: "Dynamic",
    contract: {
      digest: "test",
      outputSchema: {
        type: "object",
        properties: { answer: { type: "string" } },
        required: ["answer"],
        additionalProperties: false,
      },
    },
    permissions: [],
    handler: { kind: "HostCapability", capability: "test.output" },
    execution: { Targets: ["Local"], Network: "Deny", Workspace: "ReadOnly" },
    runtime: { Lifecycle: "Immediate", ProtocolVersion: 2, ResultAssessment: "ProcessExit" },
    sources: [],
    evidenceCapabilities: [],
  };
}
