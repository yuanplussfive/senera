import { describe, expect, test } from "vitest";
import { ExecutionDeltaOp, ToolCallStatus } from "../../../Source/AgentSystem/BamlClient/baml_client/types.js";
import {
  AgentActionPlannerContextBuilder,
  EmptyActionPlannerLedger,
} from "../../../Source/AgentSystem/ActionPlanner/AgentActionPlannerContext.js";
import type { AgentToolCatalogItem } from "../../../Source/AgentSystem/ToolRuntime/AgentToolCatalogProjector.js";
import type { ExecutedToolCallResult } from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";
import { projectActionPlannerBamlRequestBody } from "../../../Source/AgentSystem/ActionPlanner/AgentActionPlannerPromptProjector.js";
import { buildActionPlannerPromptEnvelope } from "../../../Source/AgentSystem/ActionPlanner/AgentActionPlannerPromptJson.js";

describe("ActionPlanner context behavior", () => {
  test("serializes machine-only planner messages without formatting whitespace", () => {
    const projected = projectActionPlannerBamlRequestBody({
      messages: [
        { role: "system", content: "planner" },
        {
          role: "user",
          content: JSON.stringify({
            context: {
              currentUserTurn: { content: "Continue" },
              timeline: [
                {
                  index: 0,
                  role: "user",
                  kind: "user_message",
                  content: "Earlier request",
                  evidenceUris: [],
                  artifactUris: [],
                },
              ],
            },
            directive: { stage: "prepareInteraction" },
          }),
        },
      ],
    });

    expect(projected.messages).toHaveLength(2);
    for (const message of projected.messages) {
      expect(message.content).not.toContain("\n");
      expect(() => JSON.parse(message.content)).not.toThrow();
    }
  });

  test("does not expose unloaded tool names as executable preparation choices", () => {
    const input = new AgentActionPlannerContextBuilder(process.cwd(), ".senera/artifacts").buildInput({
      userMessage: "Inspect the workspace",
      currentStep: 1,
      loadedToolNames: ["WorkspaceInspectTool"],
      messages: [],
      ledger: EmptyActionPlannerLedger,
      toolCatalog: [workspaceTool(), archiveTool()],
    });
    const envelope = buildActionPlannerPromptEnvelope(
      input,
      [
        {
          name: "WorkspaceInspectTool",
          description: "Inspect the workspace.",
          parameterContract: {
            format: "json_schema",
            schema: { type: "object", properties: {} },
          },
        },
      ],
      { stage: "prepareInteraction" },
    );

    expect(envelope.context.compactToolCatalog.map((tool) => tool.name)).toEqual(["WorkspaceInspectTool"]);
    expect(JSON.stringify(envelope)).not.toContain("ArchiveTool");
  });

  test("records calls and unique evidence while keeping the source ledger immutable", () => {
    const builder = new AgentActionPlannerContextBuilder(process.cwd(), ".senera/artifacts", {
      stalledStepLag: 2,
    });
    const original = structuredClone(EmptyActionPlannerLedger);
    const first = builder.advanceAfterToolResults({
      requestId: "planner-request",
      ledger: original,
      step: 1,
      results: [toolResult("call-1", "workspace summary")],
    });
    const second = builder.advanceAfterToolResults({
      requestId: "planner-request",
      ledger: first,
      step: 2,
      results: [toolResult("call-2", "workspace summary")],
    });

    expect(original).toEqual(EmptyActionPlannerLedger);
    expect(first).toMatchObject({
      calls: [
        expect.objectContaining({
          toolName: "WorkspaceInspectTool",
          status: ToolCallStatus.Success,
          evidenceUris: ["senera://evidence/workspace"],
        }),
      ],
      evidence: [expect.objectContaining({ key: "workspace", display: "workspace summary" })],
      lastNewEvidenceStep: 1,
    });
    expect(second.calls).toHaveLength(2);
    expect(second.evidence).toHaveLength(1);
    expect(second.warnings).toEqual([
      expect.objectContaining({ toolName: "WorkspaceInspectTool", count: 2, lastStep: 2 }),
    ]);
    expect(second.deltas.map((delta) => delta.op)).toEqual([
      ExecutionDeltaOp.AddCall,
      ExecutionDeltaOp.AddEvidence,
      ExecutionDeltaOp.AddCall,
    ]);
  });

  test("projects selected tools, ledger progress, and stalled state into the model input", () => {
    const builder = new AgentActionPlannerContextBuilder(process.cwd(), ".senera/artifacts", {
      stalledStepLag: 2,
    });
    const ledger = builder.advanceAfterToolResults({
      requestId: "planner-request",
      ledger: EmptyActionPlannerLedger,
      step: 1,
      results: [toolResult("call-1", "workspace summary")],
    });
    const input = builder.buildInput({
      requestId: "planner-request",
      userMessage: "Inspect the workspace",
      currentStep: 3,
      loadedToolNames: ["WorkspaceInspectTool"],
      messages: [{ role: "user", content: "Inspect the workspace" }],
      ledger,
      toolCatalog: [workspaceTool(), archiveTool()],
    });

    expect(input.runState).toMatchObject({
      loadedTools: ["WorkspaceInspectTool"],
      progress: {
        totalToolCalls: 1,
        totalEvidence: 1,
        lastNewEvidenceStep: 1,
        stalled: true,
      },
    });
    expect(input.evidenceState).toEqual([
      expect.objectContaining({
        evidenceUri: "senera://evidence/workspace",
        toolName: "WorkspaceInspectTool",
        facts: [{ name: "summary", value: "workspace summary" }],
      }),
    ]);
    expect(input.compactToolCatalog.map((tool) => [tool.name, tool.loaded])).toEqual([
      ["WorkspaceInspectTool", true],
      ["ArchiveTool", false],
    ]);
    expect(input.toolCatalog.map((tool) => [tool.name, tool.loaded])).toEqual([
      ["WorkspaceInspectTool", true],
      ["ArchiveTool", false],
    ]);
  });

  test("does not mark an empty ledger as stalled", () => {
    const builder = new AgentActionPlannerContextBuilder(process.cwd(), ".senera/artifacts", {
      stalledStepLag: 1,
    });
    const input = builder.buildInput({
      userMessage: "Explain the current state",
      currentStep: 99,
      loadedToolNames: ["WorkspaceInspectTool"],
      messages: [],
      ledger: EmptyActionPlannerLedger,
      toolCatalog: [workspaceTool()],
    });

    expect(input.runState.progress.stalled).toBe(false);
    expect(input.runState.loadedTools).toEqual(["WorkspaceInspectTool"]);
  });
});

function toolResult(callId: string, summary: string): ExecutedToolCallResult {
  return {
    callId,
    name: "WorkspaceInspectTool",
    arguments: { path: "." },
    process: { exitCode: 0, signal: null, stderr: "" },
    result: { kind: "workspace_inspection", summary },
    artifact: {
      artifactId: `art_${callId}`,
      artifactUri: `senera://artifact/${callId}`,
      artifactPath: `.senera/artifacts/${callId}`,
      relativePath: `.senera/artifacts/${callId}`,
      manifestPath: `.senera/artifacts/${callId}/manifest.json`,
      files: {},
      summary,
      evidence: [
        {
          key: "workspace",
          evidenceUri: "senera://evidence/workspace",
          kind: "workspace_summary",
          locator: "workspace://.",
          display: summary,
          label: "workspace",
          source: summary,
          confidence: 1,
          modelSlots: [{ name: "summary", value: summary }],
          plannerMemory: {
            facts: [{ name: "summary", value: summary }],
            artifactRefs: ["projection"],
          },
        },
      ],
      delta: [],
    },
  };
}

function workspaceTool(): AgentToolCatalogItem {
  return toolCatalogItem("WorkspaceInspectTool", "Inspect workspace", ["workspace", "inspection"]);
}

function archiveTool(): AgentToolCatalogItem {
  return toolCatalogItem("ArchiveTool", "Archive output", ["archive"]);
}

function toolCatalogItem(name: string, title: string, evidence: string[]): AgentToolCatalogItem {
  return {
    name,
    title,
    summary: `${title} summary`,
    rootKind: "System",
    capabilities: [
      {
        id: `${name}.capability`,
        title,
        description: `${title} capability`,
        facets: { Evidence: evidence },
      },
    ],
    tags: [],
    useCases: [],
    examples: [],
    avoid: [],
    permissions: [],
    evidenceCapabilities: [
      {
        produces: evidence[0] ?? "",
        quality: "verified",
        satisfies: evidence,
        kinds: evidence,
        capabilityIds: [`${name}.capability`],
      },
    ],
  };
}
