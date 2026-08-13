import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { resolveArtifactsConfig } from "../../../Source/AgentSystem/AgentDefaults.js";
import { AgentToolExecutionArtifactRecorder } from "../../../Source/AgentSystem/Artifacts/AgentToolExecutionArtifactRecorder.js";
import { SeneraLocalExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import type {
  AgentPiPlanningCompileRequest,
  AgentPiPlanningCompilerFactory,
} from "../../../Source/AgentSystem/Pi/AgentPiPlanningCompiler.js";
import { AgentPiSubstrate } from "../../../Source/AgentSystem/Pi/AgentPiSubstrate.js";
import { AgentPiTurnState } from "../../../Source/AgentSystem/Pi/AgentPiTurnState.js";
import { AgentSkillScanner } from "../../../Source/AgentSystem/Skills/AgentSkillScanner.js";
import { listDefaultAgentHostCapabilityNames } from "../../../Source/AgentSystem/AgentDefaultHostCapabilities.js";
import { AgentSessionApprovalLeaseStore } from "../../../Source/AgentSystem/Safety/AgentSessionApprovalLeaseStore.js";
import { AgentToolPermissionGate } from "../../../Source/AgentSystem/Safety/AgentToolPermissionGate.js";
import {
  registerAgentSystemToolHandlers,
  systemToolCapability,
} from "../../../Source/AgentSystem/SystemTools/AgentSystemToolCatalog.js";
import { AgentSystemExtensionCatalog } from "../../../Source/AgentSystem/SystemTools/AgentSystemToolSource.js";
import { createAgentSystemTools } from "../../../Source/AgentSystem/SystemTools/AgentSystemTools.js";
import {
  AgentModelUsageLedger,
  AgentModelUsageSources,
} from "../../../Source/AgentSystem/ModelEndpoints/AgentModelUsage.js";
import { AgentPiToolPlanCoordinator } from "../../../Source/AgentSystem/PiShared/AgentPiToolPlanCoordinator.js";
import { AgentTurnTokenBudget } from "../../../Source/AgentSystem/Text/AgentTurnTokenBudget.js";
import { AgentToolCallExecutor } from "../../../Source/AgentSystem/ToolRuntime/AgentToolCallExecutor.js";
import {
  createAgentToolAccessGrant,
  type AgentToolAccessGrant,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";
import { AgentToolHostCapabilityRegistry } from "../../../Source/AgentSystem/ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { toolProcessSuccessResult } from "../../../Source/AgentSystem/ToolRuntime/AgentToolProcessEnvelope.js";
import type {
  AgentSystemConfig,
  ResolvedAgentModelProviderConfig,
} from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import { createXmlProtocolSpec } from "../../../Source/AgentSystem/Xml/AgentXmlPolicy.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";

const AddToolName = "AddNumbersTool";
const AddCapability = "test.add_numbers";
const AddArgumentsSchema = z.object({ left: z.number(), right: z.number() });
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => fs.rm(root, { force: true, maxRetries: 8, recursive: true, retryDelay: 100 })),
  );
});

describe("Pi Coding Agent production substrate", () => {
  test("authorizes and reads an external host file through the production WorkspaceRead chain", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const externalRoot = await createTemporaryWorkspace();
    const externalFile = path.join(externalRoot, "outside-workspace.txt");
    const marker = "EXTERNAL_WORKSPACE_READ_E2E";
    await fs.writeFile(externalFile, marker, "utf8");
    const config = testConfig(workspaceRoot);
    const modelProvider = createModelProvider({
      Id: "external-workspace-read-test",
      Model: "deterministic-external-workspace-read",
      ContextWindowTokens: 16_384,
      MaxModelOutputTokens: 1_024,
    });
    const compiler = new RecordingCompilerFactory((request) =>
      request.context.messages.some((message) => message.role === "toolResult")
        ? { kind: "final_text", content: "The external file was read.", toolCalls: [] }
        : {
            kind: "tool_calls",
            content: "Reading the requested file.",
            toolCalls: [{ id: "call_external_read", name: "WorkspaceRead", arguments: { path: externalFile } }],
          },
    );
    const registry = new AgentExtensionRegistry();
    const systemTools = createAgentSystemTools(config);
    new AgentSystemExtensionCatalog().registerRoot(registry, path.resolve("System", "Extensions"), {
      capabilities: new Set([...listDefaultAgentHostCapabilityNames(), ...systemTools.map(systemToolCapability)]),
    });
    const hostCapabilities = new AgentToolHostCapabilityRegistry();
    registerAgentSystemToolHandlers(hostCapabilities, systemTools);
    const executionEnv = new SeneraLocalExecutionEnv({ workspaceRoot });
    const toolCallExecutor = new AgentToolCallExecutor({
      registry,
      config,
      protocol: createXmlProtocolSpec(config),
      workspaceRoot,
      hostCapabilities,
      executionEnv,
      emitLifecycleEvents: false,
    });
    const substrate = new AgentPiSubstrate({
      workspaceRoot,
      config,
      modelProvider,
      planningCompilerFactory: compiler,
      registry,
      toolCallExecutor,
      artifactRecorder: new AgentToolExecutionArtifactRecorder({
        workspaceRoot,
        config: resolveArtifactsConfig(config),
        model: modelProvider.Model,
      }),
      executionEnv,
      resourcesPath: path.resolve(),
      toolPermissionGate: new AgentToolPermissionGate({
        policy: {
          async decideToolCall() {
            return { action: "ask", rule: "test.external_path", reason: "External path", riskSignals: [] };
          },
        },
        sessionApprovals: new AgentSessionApprovalLeaseStore(),
        toolPlanningMode: "native",
      }),
    });
    const grant = createAgentToolAccessGrant({
      authorizedToolNames: ["WorkspaceRead"],
      exposedToolNames: ["WorkspaceRead"],
      preferredToolNames: ["WorkspaceRead"],
    });
    const turn = createTurnState("external-read-session", "external-read-request", 1, grant, modelProvider);

    try {
      const lease = await substrate.leaseTurn({
        sessionId: "external-read-session",
        requestId: "external-read-request",
        step: 1,
        input: `Read ${externalFile}.`,
        systemPrompt: "Use WorkspaceRead and report whether the file was read.",
        toolAccessGrant: grant,
        toolExposure: turn.context.toolExposure,
        tokenBudget: turn.context.tokenBudget,
        turnState: turn,
      });
      try {
        await lease.session.setHistory([]);
        await lease.session.prompt(`Read ${externalFile}.`, { source: "extension" });
        expect(lease.session.getLastAssistantText()).toBe("The external file was read.");
      } finally {
        lease.session.dispose();
      }

      expect(compiler.requests).toHaveLength(2);
      expect(JSON.stringify(compiler.requests[1]?.context.messages)).toContain(marker);
      expect(turn.takeResourceAccessGrant("call_external_read")).toBeUndefined();
    } finally {
      await substrate.close();
      await toolCallExecutor.close();
    }
  });

  test("runs an authorized host tool loop through the BAML provider and records its artifact", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const config = testConfig(workspaceRoot);
    const modelProvider = createModelProvider({
      Id: "local-substrate-test",
      Model: "deterministic-tool-loop",
      ContextWindowTokens: 16_384,
      MaxModelOutputTokens: 1_024,
    });
    const compiler = new RecordingCompilerFactory((request) =>
      request.context.messages.some((message) => message.role === "toolResult")
        ? { kind: "final_text", content: "The result is 42.", toolCalls: [] }
        : {
            kind: "tool_calls",
            content: "Adding the values.",
            toolCalls: [{ id: "call_add_numbers", name: AddToolName, arguments: { left: 17, right: 25 } }],
          },
    );
    const registry = new AgentExtensionRegistry();
    const tool = addNumbersTool(workspaceRoot);
    registry.registerToolExtension(tool.owner, [tool]);

    let executionCount = 0;
    const hostCapabilities = new AgentToolHostCapabilityRegistry().register(AddCapability, async (argumentsValue) => {
      executionCount += 1;
      const arguments_ = AddArgumentsSchema.parse(argumentsValue);
      return toolProcessSuccessResult({ sum: arguments_.left + arguments_.right });
    });
    const executionEnv = new SeneraLocalExecutionEnv({ workspaceRoot });
    const toolCallExecutor = new AgentToolCallExecutor({
      registry,
      config,
      protocol: createXmlProtocolSpec(config),
      workspaceRoot,
      hostCapabilities,
      executionEnv,
      emitLifecycleEvents: false,
    });
    const recorder = new AgentToolExecutionArtifactRecorder({
      workspaceRoot,
      config: resolveArtifactsConfig(config),
      model: modelProvider.Model,
    });
    const artifactUris: string[] = [];
    const substrate = new AgentPiSubstrate({
      workspaceRoot,
      config,
      modelProvider,
      planningCompilerFactory: compiler,
      registry,
      toolCallExecutor,
      artifactRecorder: {
        record: async (input) => {
          const results = await recorder.record(input);
          artifactUris.push(...results.flatMap((result) => (result.artifact ? [result.artifact.artifactUri] : [])));
          return results;
        },
      },
      executionEnv,
      resourcesPath: workspaceRoot,
    });
    const grant = createAgentToolAccessGrant({
      authorizedToolNames: [AddToolName],
      exposedToolNames: [AddToolName],
      preferredToolNames: [AddToolName],
    });
    const turn = createTurnState("substrate-local-session", "substrate-local-request", 1, grant, modelProvider);

    try {
      const lease = await substrate.leaseTurn({
        sessionId: "substrate-local-session",
        requestId: "substrate-local-request",
        step: 1,
        input: "Add 17 and 25.",
        systemPrompt: `Use ${AddToolName} for arithmetic and answer with its result.`,
        toolAccessGrant: grant,
        toolExposure: turn.context.toolExposure,
        tokenBudget: turn.context.tokenBudget,
        turnState: turn,
      });
      const completedToolResults: unknown[] = [];
      const listenerStarted = deferred();
      const listenerRelease = deferred();
      let listenerCompleted = false;
      const unsubscribe = lease.session.subscribe(async (event) => {
        if (event.type !== "tool_execution_end") return;
        listenerStarted.resolve();
        await listenerRelease.promise;
        completedToolResults.push(event.result);
        listenerCompleted = true;
      });
      try {
        expect(lease.historyMigrationRequired).toBe(true);
        expect(() => lease.session.setHistory([])).not.toThrow();
        expect(lease.session.getActiveToolNames()).toEqual([AddToolName]);
        const prompt = lease.session.prompt("Add 17 and 25.", { source: "extension" });
        await listenerStarted.promise;
        expect(listenerCompleted).toBe(false);
        listenerRelease.resolve();
        await prompt;
        expect(listenerCompleted).toBe(true);
        expect(lease.session.getLastAssistantText()).toBe("The result is 42.");
      } finally {
        unsubscribe();
        lease.session.dispose();
      }

      expect(executionCount).toBe(1);
      expect(completedToolResults).toHaveLength(1);
      expect(artifactUris).toHaveLength(1);
      expect(compiler.requests).toHaveLength(2);
      expect(compiler.requests[0]?.model.api).toBe("senera-planning");
      const toolResult = compiler.requests[1]?.context.messages.find((message) => message.role === "toolResult");
      expect(toolResult).toBeDefined();
      expect(JSON.stringify(toolResult)).toContain("senera.tool_observation.v3");
      expect(JSON.stringify(toolResult)).toContain(artifactUris[0]);
    } finally {
      await substrate.close();
      await toolCallExecutor.close();
    }
  });

  test("compacts during one repeated tool loop and continues with the rebuilt context", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const config = testConfig(workspaceRoot);
    const modelProvider = createModelProvider({
      Id: "mid-run-compaction-test",
      Model: "deterministic-mid-run-compaction",
      ContextWindowTokens: 4_096,
      MaxModelOutputTokens: 1_536,
    });
    const compiler = new RecordingCompilerFactory(
      (_request, index) =>
        index < 4
          ? {
              kind: "tool_calls",
              content: `Collecting evidence ${index + 1}.`,
              toolCalls: [
                {
                  id: `call_compaction_${index + 1}`,
                  name: AddToolName,
                  arguments: { left: index, right: index + 1 },
                },
              ],
            }
          : { kind: "final_text", content: "The compacted tool loop completed.", toolCalls: [] },
      (_request, index) => [500, 1_000, 1_500, 1_800, 700][index] ?? 700,
    );
    const registry = new AgentExtensionRegistry();
    const tool = addNumbersTool(workspaceRoot);
    registry.registerToolExtension(tool.owner, [tool]);
    const hostCapabilities = new AgentToolHostCapabilityRegistry().register(AddCapability, async (argumentsValue) => {
      const arguments_ = AddArgumentsSchema.parse(argumentsValue);
      return toolProcessSuccessResult({
        sum: arguments_.left + arguments_.right,
        evidence: "mid-run context evidence ".repeat(400),
      });
    });
    const executionEnv = new SeneraLocalExecutionEnv({ workspaceRoot });
    const toolCallExecutor = new AgentToolCallExecutor({
      registry,
      config,
      protocol: createXmlProtocolSpec(config),
      workspaceRoot,
      hostCapabilities,
      executionEnv,
      emitLifecycleEvents: false,
    });
    const substrate = new AgentPiSubstrate({
      workspaceRoot,
      config,
      modelProvider,
      planningCompilerFactory: compiler,
      registry,
      toolCallExecutor,
      artifactRecorder: new AgentToolExecutionArtifactRecorder({
        workspaceRoot,
        config: resolveArtifactsConfig(config),
        model: modelProvider.Model,
      }),
      executionEnv,
      resourcesPath: workspaceRoot,
    });
    const grant = createAgentToolAccessGrant({
      authorizedToolNames: [AddToolName],
      exposedToolNames: [AddToolName],
      preferredToolNames: [AddToolName],
    });
    const turn = createTurnState("mid-run-session", "mid-run-request", 1, grant, modelProvider);

    try {
      const lease = await substrate.leaseTurn({
        sessionId: "mid-run-session",
        requestId: "mid-run-request",
        step: 1,
        input: "Collect enough evidence to require context compaction.",
        systemPrompt: `Use ${AddToolName} repeatedly and then answer.`,
        toolAccessGrant: grant,
        toolExposure: turn.context.toolExposure,
        tokenBudget: turn.context.tokenBudget,
        turnState: turn,
      });
      try {
        await lease.session.setHistory([]);
        await lease.session.prompt("Run the repeated tool task.", { source: "extension" });
        expect(lease.session.getLastAssistantText()).toBe("The compacted tool loop completed.");
      } finally {
        lease.session.dispose();
      }

      expect(compiler.requests).toHaveLength(5);
      expect(compiler.summarizations).toBeGreaterThan(0);
      expect(
        compiler.requests.some((request) =>
          request.context.messages.some(
            (message) =>
              message.role === "user" &&
              (typeof message.content === "string"
                ? message.content
                : message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
              ).includes("<compaction_summary>"),
          ),
        ),
      ).toBe(true);
      const budget = turn.context.tokenBudget.snapshot();
      expect(budget.occupiedTokens).toBeLessThan(budget.inputCapacityTokens);
      expect(budget.availableTokens).toBeGreaterThan(0);
    } finally {
      await substrate.close();
      await toolCallExecutor.close();
    }
  });

  test("reloads a published Skill and project context for the next turn of one persistent session", async () => {
    const workspaceRoot = await createTemporaryWorkspace();
    const config = testConfig(workspaceRoot);
    const modelProvider = createModelProvider({
      Id: "skill-reload-test",
      Model: "deterministic-skill-reload",
      ContextWindowTokens: 16_384,
      MaxModelOutputTokens: 1_024,
    });
    const compiler = new RecordingCompilerFactory(() => ({
      kind: "final_text",
      content: "Skill applied.",
      toolCalls: [],
    }));
    const registry = new AgentExtensionRegistry();
    const projectContextFile = path.join(workspaceRoot, ".senera", "context", "PROJECT.md");
    await writeProjectContext(projectContextFile, "FIRST_PROJECT_CONTEXT");
    const skillRoot = path.join(workspaceRoot, "System", "Extensions", "test-extension", "skills", "hot-skill");
    await writeSkill(skillRoot, "FIRST_SKILL_BODY");
    await writeSkill(
      path.join(workspaceRoot, ".senera", "skills", "unselected-skill"),
      "UNSELECTED_SKILL_BODY",
      "unselected-skill",
    );
    const scanner = new AgentSkillScanner();
    const firstSkill = scanner.readSkillDirectory(skillRoot, "hot-skill");
    registry.registerSkill(firstSkill);

    const executionEnv = new SeneraLocalExecutionEnv({ workspaceRoot });
    const toolCallExecutor = new AgentToolCallExecutor({
      registry,
      config,
      protocol: createXmlProtocolSpec(config),
      workspaceRoot,
      executionEnv,
      emitLifecycleEvents: false,
    });
    const substrate = new AgentPiSubstrate({
      workspaceRoot,
      config,
      modelProvider,
      planningCompilerFactory: compiler,
      registry,
      toolCallExecutor,
      artifactRecorder: new AgentToolExecutionArtifactRecorder({
        workspaceRoot,
        config: resolveArtifactsConfig(config),
        model: modelProvider.Model,
      }),
      executionEnv,
      resourcesPath: workspaceRoot,
    });
    const grant = createAgentToolAccessGrant({
      authorizedToolNames: [],
      exposedToolNames: [],
      preferredToolNames: [],
    });

    try {
      const firstActivatedSkill = activatedSkill(firstSkill);
      const firstTurn = createTurnState("skill-reload-session", "skill-reload-first", 1, grant, modelProvider, [
        firstActivatedSkill,
      ]);
      const firstLease = await substrate.leaseTurn({
        sessionId: "skill-reload-session",
        requestId: "skill-reload-first",
        step: 1,
        input: "Use the active Skill.",
        systemPrompt: "Follow the activated Skill.",
        toolAccessGrant: grant,
        toolExposure: firstTurn.context.toolExposure,
        tokenBudget: firstTurn.context.tokenBudget,
        turnState: firstTurn,
        activeSkills: [firstActivatedSkill],
      });
      try {
        expect(firstLease.historyMigrationRequired).toBe(true);
        await firstLease.session.prompt("First turn.", { source: "extension" });
      } finally {
        firstLease.session.dispose();
      }

      await writeSkill(skillRoot, "SECOND_SKILL_BODY");
      await writeProjectContext(projectContextFile, "SECOND_PROJECT_CONTEXT");
      const secondSkill = scanner.readSkillDirectory(skillRoot, "hot-skill");
      registry.replaceSkills("standalone:hot-skill", [secondSkill]);
      const secondActivatedSkill = activatedSkill(secondSkill);
      const secondTurn = createTurnState("skill-reload-session", "skill-reload-second", 2, grant, modelProvider, [
        secondActivatedSkill,
      ]);
      const secondLease = await substrate.leaseTurn({
        sessionId: "skill-reload-session",
        requestId: "skill-reload-second",
        step: 2,
        input: "Use the updated active Skill.",
        systemPrompt: "Follow the activated Skill.",
        toolAccessGrant: grant,
        toolExposure: secondTurn.context.toolExposure,
        tokenBudget: secondTurn.context.tokenBudget,
        turnState: secondTurn,
        activeSkills: [secondActivatedSkill],
      });
      try {
        expect(secondLease.historyMigrationRequired).toBe(false);
        await secondLease.session.prompt("Second turn.", { source: "extension" });
      } finally {
        secondLease.session.dispose();
      }

      expect(compiler.requests).toHaveLength(2);
      const firstPrompt = compiler.requests[0]?.context.systemPrompt ?? "";
      const secondPrompt = compiler.requests[1]?.context.systemPrompt ?? "";
      expect(textOccurrences(firstPrompt, "FIRST_SKILL_BODY")).toBe(1);
      expect(textOccurrences(firstPrompt, "FIRST_PROJECT_CONTEXT")).toBe(1);
      expect(firstPrompt).not.toContain("UNSELECTED_SKILL_BODY");
      expect(secondPrompt).not.toContain("FIRST_SKILL_BODY");
      expect(secondPrompt).not.toContain("FIRST_PROJECT_CONTEXT");
      expect(textOccurrences(secondPrompt, "SECOND_SKILL_BODY")).toBe(1);
      expect(textOccurrences(secondPrompt, "SECOND_PROJECT_CONTEXT")).toBe(1);
      expect(secondPrompt).not.toContain("UNSELECTED_SKILL_BODY");
    } finally {
      await substrate.close();
      await toolCallExecutor.close();
    }
  });
});

class RecordingCompilerFactory implements AgentPiPlanningCompilerFactory {
  readonly requests: AgentPiPlanningCompileRequest[] = [];
  summarizations = 0;

  constructor(
    private readonly respond: (
      request: AgentPiPlanningCompileRequest,
      index: number,
    ) => Awaited<ReturnType<ReturnType<AgentPiPlanningCompilerFactory["create"]>["compile"]>>,
    private readonly inputTokens?: (request: AgentPiPlanningCompileRequest, index: number) => number,
  ) {}

  create(
    options?: Parameters<AgentPiPlanningCompilerFactory["create"]>[0],
  ): ReturnType<AgentPiPlanningCompilerFactory["create"]> {
    return {
      compile: async (request) => {
        this.requests.push(request);
        const index = this.requests.length - 1;
        const inputTokens = this.inputTokens?.(request, index);
        if (inputTokens !== undefined) {
          options?.usageSink?.({
            stage: "test.pi.mid_run",
            usage: {
              source: AgentModelUsageSources.ProviderReported,
              inputTokens,
              outputTokens: 10,
              totalTokens: inputTokens + 10,
            },
          });
        }
        return this.respond(request, index);
      },
      summarize: async () => {
        this.summarizations += 1;
        return "Native provider test summary.";
      },
    };
  }
}

function createTurnState(
  sessionId: string,
  requestId: string,
  step: number,
  toolAccessGrant: AgentToolAccessGrant,
  modelProvider: ResolvedAgentModelProviderConfig,
  activeSkills: AgentPiTurnState["context"]["activeSkills"] = [],
): AgentPiTurnState {
  return new AgentPiTurnState({
    approvalMode: "agent",
    sessionId,
    requestId,
    step,
    toolAccessGrant,
    toolExposure: new AgentToolExposureState(toolAccessGrant),
    activeSkills,
    usageLedger: new AgentModelUsageLedger(),
    toolPlan: new AgentPiToolPlanCoordinator(),
    tokenBudget: new AgentTurnTokenBudget({
      model: modelProvider.Model,
      contextWindowTokens: modelProvider.ContextWindowTokens,
      outputReserveTokens: modelProvider.MaxModelOutputTokens ?? 1_024,
    }),
  });
}

function addNumbersTool(workspaceRoot: string): RegisteredTool {
  return {
    owner: {
      kind: "system",
      name: "test-math",
      title: "Test math",
      description: "Deterministic arithmetic tools.",
      rootPath: workspaceRoot,
      revision: "test",
      trusted: true,
      requiresApproval: false,
    },
    name: AddToolName,
    loading: "Dynamic",
    contract: {
      digest: "add-numbers-test-contract",
      arguments: {
        tsHintLines: [],
        xmlPreview: "",
        properties: [],
        jsonSchema: {
          type: "object",
          properties: {
            left: { type: "number" },
            right: { type: "number" },
          },
          required: ["left", "right"],
          additionalProperties: false,
        },
      },
    },
    permissions: [],
    handler: { kind: "HostCapability", capability: AddCapability },
    execution: { Targets: ["Local"], Network: "Deny", Workspace: "ReadOnly" },
    runtime: { Lifecycle: "Immediate", ProtocolVersion: 2, ResultAssessment: "ProcessExit" },
    sources: [],
    childGrant: "inherit",
    evidenceCapabilities: [],
  };
}

async function createTemporaryWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), "senera-pi-substrate-"));
  temporaryRoots.push(root);
  await Promise.all([
    fs.mkdir(path.join(root, ".senera"), { recursive: true }),
    fs.mkdir(path.join(root, "System", "Skills"), { recursive: true }),
  ]);
  return root;
}

function testConfig(workspaceRoot: string): AgentSystemConfig {
  return {
    ModelProviders: [],
    Server: { Host: "127.0.0.1", Port: 8787 },
    AgentLoop: { PiSessions: { RootDir: path.join(workspaceRoot, ".senera", "pi-sessions") } },
  };
}

async function writeSkill(skillRoot: string, marker: string, name = "hot-skill"): Promise<void> {
  await fs.mkdir(skillRoot, { recursive: true });
  await fs.writeFile(
    path.join(skillRoot, "SKILL.md"),
    `---\nname: ${name}\ndescription: Verify persistent-session Skill reloads.\n---\n\n# Skill\n\n${marker}\n`,
    "utf8",
  );
}

async function writeProjectContext(filePath: string, marker: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `# Project context\n\n${marker}\n`, "utf8");
}

function activatedSkill(skill: ReturnType<AgentSkillScanner["readSkillDirectory"]>) {
  return {
    name: skill.name,
    revision: skill.revision ?? skill.source.id,
    title: skill.name,
    summary: skill.description,
    useCases: [],
    avoid: [],
    recommendedTools: [],
    evidenceRequirements: [],
    descriptionFile: skill.descriptionFile,
    matchedTerms: ["hot-skill"],
    matchedFields: [{ term: "hot-skill", fields: ["explicitInvocation"] }],
    score: 1,
  };
}

function textOccurrences(source: string, target: string): number {
  return source.split(target).length - 1;
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}
