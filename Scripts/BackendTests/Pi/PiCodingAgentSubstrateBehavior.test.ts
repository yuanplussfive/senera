import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { resolveArtifactsConfig } from "../../../Source/AgentSystem/AgentDefaults.js";
import { AgentToolExecutionArtifactRecorder } from "../../../Source/AgentSystem/Artifacts/AgentToolExecutionArtifactRecorder.js";
import { SeneraLocalExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { AgentPiSubstrate } from "../../../Source/AgentSystem/Pi/AgentPiSubstrate.js";
import { AgentSkillScanner } from "../../../Source/AgentSystem/Skills/AgentSkillScanner.js";
import {
  AgentPiProxyModelProviderHeader,
  AgentPiProxyProtocol,
} from "../../../Source/AgentSystem/PiShared/AgentPiProxyProtocol.js";
import { AgentPiTurnContextRegistry } from "../../../Source/AgentSystem/PiShared/AgentPiTurnContext.js";
import { AgentToolCallExecutor } from "../../../Source/AgentSystem/ToolRuntime/AgentToolCallExecutor.js";
import { createAgentToolAccessGrant } from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolHostCapabilityRegistry } from "../../../Source/AgentSystem/ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { toolProcessSuccessResult } from "../../../Source/AgentSystem/ToolRuntime/AgentToolProcessEnvelope.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import { createXmlProtocolSpec } from "../../../Source/AgentSystem/Xml/AgentXmlPolicy.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";

const AddToolName = "AddNumbersTool";
const AddCapability = "test.add_numbers";
const AddArgumentsSchema = z.object({ left: z.number(), right: z.number() });

const OpenAiRequestSchema = z.object({
  model: z.string(),
  messages: z.array(z.object({ role: z.string() }).passthrough()),
  tools: z
    .array(
      z
        .object({
          function: z.object({ name: z.string() }).passthrough(),
        })
        .passthrough(),
    )
    .optional(),
  stream: z.boolean().optional(),
});

type OpenAiRequest = z.infer<typeof OpenAiRequestSchema>;

interface CapturedRequest {
  readonly headers: IncomingMessage["headers"];
  readonly payload: OpenAiRequest;
}

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Pi Coding Agent production substrate", () => {
  test("runs an authorized HostCapability tool loop and records its artifact through a local proxy", async () => {
    const requests: CapturedRequest[] = [];
    const server = createDeterministicProxy(requests);
    const workspaceRoot = await createTemporaryWorkspace();
    const baseUrl = await listen(server);
    const port = new URL(baseUrl).port;
    const config: AgentSystemConfig = {
      ModelProviders: [],
      Server: { Host: "127.0.0.1", Port: Number(port) },
    };
    const modelProvider = createModelProvider({
      Id: "local-substrate-test",
      Model: "deterministic-tool-loop",
      ContextWindowTokens: 16_384,
      MaxModelOutputTokens: 1_024,
    });
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
      turnContexts: new AgentPiTurnContextRegistry(),
    });
    const grant = createAgentToolAccessGrant({
      authorizedToolNames: [AddToolName],
      exposedToolNames: [AddToolName],
      preferredToolNames: [AddToolName],
    });

    try {
      const lease = await substrate.leaseTurn({
        sessionId: "substrate-local-session",
        requestId: "substrate-local-request",
        step: 1,
        input: "Add 17 and 25.",
        systemPrompt: `Use ${AddToolName} for arithmetic and answer with its result.`,
        toolAccessGrant: grant,
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
        expect(lease.session.getLastAssistantText()).toMatch(/42/u);
      } finally {
        unsubscribe();
        lease.session.dispose();
      }

      expect(executionCount).toBe(1);
      expect(completedToolResults).toHaveLength(1);
      expect(completedToolResults[0]).toEqual(
        expect.objectContaining({ content: expect.arrayContaining([expect.objectContaining({ type: "text" })]) }),
      );
      expect(requests).toHaveLength(2);
      assertRequest(requests[0], false, modelProvider.Id);
      assertRequest(requests[1], true, modelProvider.Id);
      expect(artifactUris).toHaveLength(1);
      expect(requests[1]?.payload.messages).toEqual(
        expect.arrayContaining([expect.objectContaining({ role: "tool" })]),
      );
      expect(JSON.stringify(requests[1]?.payload.messages)).toContain(artifactUris[0]);
    } finally {
      await substrate.close();
      await toolCallExecutor.close();
      await close(server);
    }
  });

  test("reloads a published Skill for the next turn of the same persistent session", async () => {
    const requests: CapturedRequest[] = [];
    const server = createFinalTextProxy(requests);
    const workspaceRoot = await createTemporaryWorkspace();
    const baseUrl = await listen(server);
    const config: AgentSystemConfig = {
      ModelProviders: [],
      Server: { Host: "127.0.0.1", Port: Number(new URL(baseUrl).port) },
    };
    const modelProvider = createModelProvider({
      Id: "skill-reload-test",
      Model: "deterministic-skill-reload",
      ContextWindowTokens: 16_384,
      MaxModelOutputTokens: 1_024,
    });
    const registry = new AgentExtensionRegistry();
    const projectContextFile = path.join(workspaceRoot, ".senera", "context", "PROJECT.md");
    await writeProjectContext(projectContextFile, "FIRST_PROJECT_CONTEXT");
    const skillRoot = path.join(workspaceRoot, ".senera", "skills", "hot-skill");
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
      registry,
      toolCallExecutor,
      artifactRecorder: new AgentToolExecutionArtifactRecorder({
        workspaceRoot,
        config: resolveArtifactsConfig(config),
        model: modelProvider.Model,
      }),
      executionEnv,
      resourcesPath: workspaceRoot,
      turnContexts: new AgentPiTurnContextRegistry(),
    });
    const grant = createAgentToolAccessGrant({
      authorizedToolNames: [],
      exposedToolNames: [],
      preferredToolNames: [],
    });

    try {
      const firstLease = await substrate.leaseTurn({
        sessionId: "skill-reload-session",
        requestId: "skill-reload-first",
        step: 1,
        input: "Use the active Skill.",
        systemPrompt: "Follow the activated Skill.",
        toolAccessGrant: grant,
        activeSkills: [activatedSkill(firstSkill)],
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
      const secondLease = await substrate.leaseTurn({
        sessionId: "skill-reload-session",
        requestId: "skill-reload-second",
        step: 2,
        input: "Use the updated active Skill.",
        systemPrompt: "Follow the activated Skill.",
        toolAccessGrant: grant,
        activeSkills: [activatedSkill(secondSkill)],
      });
      try {
        expect(secondLease.historyMigrationRequired).toBe(false);
        await secondLease.session.prompt("Second turn.", { source: "extension" });
      } finally {
        secondLease.session.dispose();
      }

      expect(requests).toHaveLength(2);
      const firstPayload = JSON.stringify(requests[0]?.payload);
      const secondPayload = JSON.stringify(requests[1]?.payload);
      expect(textOccurrences(firstPayload, "FIRST_SKILL_BODY")).toBe(1);
      expect(textOccurrences(firstPayload, "FIRST_PROJECT_CONTEXT")).toBe(1);
      expect(firstPayload).not.toContain("UNSELECTED_SKILL_BODY");
      expect(secondPayload).not.toContain("FIRST_SKILL_BODY");
      expect(secondPayload).not.toContain("FIRST_PROJECT_CONTEXT");
      expect(textOccurrences(secondPayload, "SECOND_SKILL_BODY")).toBe(1);
      expect(textOccurrences(secondPayload, "SECOND_PROJECT_CONTEXT")).toBe(1);
      expect(secondPayload).not.toContain("UNSELECTED_SKILL_BODY");
    } finally {
      await substrate.close();
      await toolCallExecutor.close();
      await close(server);
    }
  });
});

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

function createDeterministicProxy(requests: CapturedRequest[]): Server {
  return createServer((request, response) => {
    void handleProxyRequest(request, response, requests).catch((error: unknown) => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    });
  });
}

function createFinalTextProxy(requests: CapturedRequest[]): Server {
  return createServer((request, response) => {
    void (async () => {
      assert.equal(request.method, "POST");
      assert.equal(request.url, AgentPiProxyProtocol.routes.chatCompletions);
      const payload = OpenAiRequestSchema.parse(JSON.parse(await readRequestBody(request)));
      requests.push({ headers: request.headers, payload });
      writeOpenAiStream(response, finalTextChunks());
    })().catch((error: unknown) => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    });
  });
}

async function handleProxyRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requests: CapturedRequest[],
): Promise<void> {
  assert.equal(request.method, "POST");
  assert.equal(request.url, AgentPiProxyProtocol.routes.chatCompletions);
  const payload = OpenAiRequestSchema.parse(JSON.parse(await readRequestBody(request)));
  requests.push({ headers: request.headers, payload });
  const hasToolResult = payload.messages.some((message) => message.role === "tool");
  writeOpenAiStream(response, hasToolResult ? finalTextChunks() : toolCallChunks());
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function writeOpenAiStream(response: ServerResponse, chunks: readonly object[]): void {
  response.writeHead(200, {
    "cache-control": "no-cache",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
  });
  for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  response.end("data: [DONE]\n\n");
}

function toolCallChunks(): object[] {
  return [
    completionChunk({
      role: "assistant",
      tool_calls: [
        {
          index: 0,
          id: "call_add_numbers",
          type: "function",
          function: { name: AddToolName, arguments: '{"left":17,"right":25}' },
        },
      ],
    }),
    completionChunk({}, "tool_calls"),
  ];
}

function finalTextChunks(): object[] {
  return [completionChunk({ role: "assistant", content: "The result is 42." }), completionChunk({}, "stop")];
}

function completionChunk(delta: object, finishReason: string | null = null): object {
  return {
    id: "chatcmpl-substrate-test",
    object: "chat.completion.chunk",
    created: 0,
    model: "deterministic-tool-loop",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function assertRequest(request: CapturedRequest | undefined, expectsToolResult: boolean, providerId: string): void {
  assert(request, "Expected a captured Coding Agent request.");
  assert.equal(request.headers.authorization, `Bearer ${AgentPiProxyProtocol.apiKey}`);
  assert.equal(request.headers[AgentPiProxyModelProviderHeader], providerId);
  assert.equal(request.payload.stream, true);
  assert(request.payload.tools?.some((tool) => tool.function.name === AddToolName));
  assert.equal(
    request.payload.messages.some((message) => message.role === "tool"),
    expectsToolResult,
  );
}

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
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
