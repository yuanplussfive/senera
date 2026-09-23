import { describe, expect, test } from "vitest";
import { SeneraLocalExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import { AgentToolHostCapabilityRegistry } from "../../../Source/AgentSystem/ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { toolProcessSuccessResult } from "../../../Source/AgentSystem/ToolRuntime/AgentToolProcessEnvelope.js";
import { AgentToolRunner } from "../../../Source/AgentSystem/ToolRuntime/AgentToolRunner.js";
import { AgentJsonSchemaPromptContractProjector } from "../../../Source/AgentSystem/ToolContracts/AgentJsonSchemaPromptContractProjector.js";
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
            issues: expect.arrayContaining([
              expect.objectContaining({
                keyword: "type",
                path: ["answer"],
                pointer: "/answer",
                schemaPointer: "#/properties/answer/type",
              }),
            ]),
          },
          diagnostics: expect.arrayContaining([
            expect.objectContaining({ code: "type", path: ["answer"], pointer: "/answer" }),
          ]),
        },
      });
    } finally {
      await runner.close();
      removeDirectory(workspaceRoot);
    }
  });

  test("validates the provider shape before a resource projection changes it", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-output-contract-projection");
    const tool = registeredTool(workspaceRoot);
    const capabilities = new AgentToolHostCapabilityRegistry().register("test.output", async () =>
      toolProcessSuccessResult(
        { answer: "senera://resource/upl_projected" },
        { validationResult: { answer: "provider-value" } },
      ),
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
      expect(result.response).toEqual(
        expect.objectContaining({ ok: true, result: { answer: "senera://resource/upl_projected" } }),
      );
      expect(result).not.toHaveProperty("validationResult");
    } finally {
      await runner.close();
      removeDirectory(workspaceRoot);
    }
  });

  test("projects parameter validation failures into actionable schema-detail messages", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-argument-contract");
    const tool = argumentContractTool(workspaceRoot);
    const capabilities = new AgentToolHostCapabilityRegistry().register("test.argument", async () =>
      toolProcessSuccessResult({ ok: "done" }),
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
      const error = result.response.ok ? undefined : result.response.error;
      expect(error).toMatchObject({
        code: AgentExecutionErrorCodes.InvalidToolArguments,
        details: {
          phase: AgentToolProcessErrorPhases.SchemaValidation,
          toolName: "ArgumentContractTool",
          issues: expect.arrayContaining([
            expect.objectContaining({ keyword: "required", path: ["city"], pointer: "/city" }),
          ]),
        },
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: "required", path: ["city"], pointer: "/city" }),
        ]),
      });
      // The model can locate the exact field and expected value without guessing.
      expect(error?.message).toContain("ArgumentContractTool.city");
      expect(error?.message).toMatch(/must have required property 'city'/);
      expect(error?.message).not.toMatch(/^Invalid arguments for ArgumentContractTool/);
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
    childGrant: "inherit",
    evidenceCapabilities: [],
  };
}

function argumentContractTool(workspaceRoot: string): RegisteredTool {
  const base = registeredTool(workspaceRoot);
  const contracts = new AgentJsonSchemaPromptContractProjector();
  return {
    ...base,
    name: "ArgumentContractTool",
    contract: {
      digest: "argument-contract-v1",
      arguments: contracts.project({
        type: "object",
        properties: { city: { type: "string", description: "目标城市。" } },
        required: ["city"],
        additionalProperties: false,
      }),
    },
  };
}
