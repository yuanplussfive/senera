import { expect, test, vi } from "vitest";
import type { Context } from "@earendil-works/pi-ai";
import { AgentPiContextInspection } from "../../../Source/AgentSystem/Pi/AgentPiContextInspection.js";
import { AgentPiTurnState } from "../../../Source/AgentSystem/Pi/AgentPiTurnState.js";
import {
  completedStream,
  createFrame,
  createTurnState,
  nativeApiStreams,
  tool,
} from "../Support/PiNativeToolProviderFixtures.js";
import type { AgentResourcePublisher } from "../../../Source/AgentSystem/Resources/AgentResourcePublisher.js";
import { AgentPiRunCollector } from "../../../Source/AgentSystem/Pi/AgentPiRunCollector.js";
import { AgentEventKinds, type AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { failureMessage } from "../Support/PiNativeToolProviderFixtures.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";
import { projectSeneraModelProviderToPi } from "../../../Source/AgentSystem/Pi/AgentPiModelProjector.js";
import { AgentPiNativeToolProvider } from "../../../Source/AgentSystem/Pi/AgentPiNativeToolProvider.js";

function stateWith(publisher: AgentResourcePublisher) {
  return new AgentPiTurnState({ ...createTurnState("test-model").context, contextPublisher: publisher });
}

function publisherFixture() {
  const contents: string[] = [];
  const publishBytes = vi.fn<AgentResourcePublisher["publishBytes"]>(async (input) => {
    contents.push(Buffer.from(input.bytes).toString());
    return {
      resourceUri: `senera://resource/test${contents.length.toString().padStart(2, "0")}`,
      localPath: "context.txt",
      name: input.name,
      mime: input.mime,
      size: input.bytes.length,
    };
  });
  return { contents, publishBytes };
}

test("snapshots normalized input and reuses unchanged section resources across model requests", async () => {
  const publisher = publisherFixture();
  const state = stateWith(publisher);
  const inspection = new AgentPiContextInspection();
  const context: Context = {
    systemPrompt: "Stable system context",
    tools: [{ name: "Read", description: "Read a file", parameters: { type: "object", properties: {} } }],
    messages: [{ role: "user", content: "Inspect the project", timestamp: 1 }],
  };
  const first = await inspection.capture({ context, model: "test-model", scope: "native", state });
  const second = await inspection.capture({
    context: { ...context, messages: [...context.messages, { role: "user", content: "Continue", timestamp: 2 }] },
    model: "test-model",
    scope: "native",
    state,
  });
  expect(first.sections.map((section) => section.category)).toEqual(["system", "tools", "user"]);
  expect(publisher.publishBytes).toHaveBeenCalledTimes(4);
  expect(publisher.publishBytes.mock.calls.every(([input]) => input.retention === "persistent")).toBe(true);
  expect(publisher.publishBytes.mock.calls.every(([input]) => input.owner?.sessionId === "native-tools-session")).toBe(
    true,
  );
  expect(second.sections.slice(0, 3)).toEqual(first.sections);
  expect(first.estimatedTokens).toBe(first.sections.reduce((sum, section) => sum + section.tokens, 0));
  expect(first).toMatchObject({ measurement: "local_estimate", contextWindow: 16384 });
  expect(publisher.contents.join("\n")).toContain("Stable system context");
});

test("typed assistant blocks retain their order, tool identities and content without changing the input", async () => {
  const publisher = publisherFixture();
  const model = projectSeneraModelProviderToPi(createModelProvider()).model;
  const assistant = failureMessage(model, "unused");
  assistant.stopReason = "toolUse";
  delete assistant.errorMessage;
  assistant.content = [
    { type: "thinking", thinking: "Inspect the file" },
    { type: "thinking", thinking: "Then check the response" },
    { type: "text", text: "I will inspect both files." },
    { type: "toolCall", name: "Read", id: "read-a", arguments: { path: "a.ts" } },
    { type: "toolCall", name: "Read", id: "read-b", arguments: { path: "b.ts" } },
  ];
  const answer = {
    ...assistant,
    stopReason: "stop" as const,
    content: [{ type: "text" as const, text: "The result." }],
  };
  const context: Context = {
    messages: [
      { role: "user", content: "Check these files", timestamp: 1 },
      assistant,
      {
        role: "toolResult",
        toolName: "Read",
        toolCallId: "read-a",
        isError: true,
        content: [{ type: "text", text: "Missing file" }],
        timestamp: 2,
      },
      answer,
    ],
  };
  const original = structuredClone(context);
  const snapshot = await new AgentPiContextInspection().capture({
    context,
    model: model.id,
    scope: "native",
    state: stateWith(publisher),
  });
  expect(snapshot.sections.map(({ category }) => category)).toEqual([
    "user",
    "thinking",
    "preface",
    "toolCall",
    "toolCall",
    "toolResult",
    "assistant",
  ]);
  expect(snapshot.sections[3]).toMatchObject({ label: "Read", toolCallId: "read-a" });
  expect(snapshot.sections[4]).toMatchObject({ label: "Read", toolCallId: "read-b" });
  expect(snapshot.sections[5]).toMatchObject({ label: "Read", toolCallId: "read-a", isError: true });
  const contents = publisher.contents.slice(1).map((content) => JSON.parse(content) as unknown[]);
  expect(contents[0]).toEqual(assistant.content.slice(0, 2));
  expect(contents.slice(0, 4).flat()).toEqual(assistant.content);
  expect(contents[5]).toEqual(answer.content);
  expect(context).toEqual(original);
});

test("records image reservations while omitting inline image bytes from readable resources", async () => {
  const publisher = publisherFixture();
  const state = stateWith(publisher);
  const snapshot = await new AgentPiContextInspection().capture({
    model: "test-model",
    scope: "native",
    state,
    context: {
      messages: [
        {
          role: "user",
          timestamp: 1,
          content: [
            { type: "text", text: "Look" },
            { type: "image", mimeType: "image/png", data: "private-image-base64" },
          ],
        },
      ],
    },
  });
  expect(snapshot.sections[0]).toMatchObject({ images: 1 });
  expect(snapshot.sections[0]!.tokens).toBeGreaterThan(1200);
  expect(publisher.contents[0]).not.toContain("private-image-base64");
  expect(publisher.contents[0]).toContain("image data omitted");
});

test("publication failure is explicit and retried on the next request", async () => {
  const publisher = publisherFixture();
  publisher.publishBytes.mockRejectedValueOnce(new Error("Storage unavailable"));
  const inspection = new AgentPiContextInspection();
  const input = {
    context: { messages: [{ role: "user" as const, content: "Hello", timestamp: 1 }] },
    model: "test-model",
    scope: "native" as const,
    state: stateWith(publisher),
  };
  const failed = await inspection.capture(input);
  expect(failed.sections[0]).toMatchObject({ contentError: "Storage unavailable" });
  expect(failed.sections[0]?.resourceUri).toBeUndefined();
  const recovered = await inspection.capture(input);
  expect(recovered.sections[0]?.resourceUri).toMatch(/^senera:\/\/resource\//u);
  expect(recovered.sections[0]?.contentError).toBeUndefined();
});

test("different inline images keep distinct identities without exposing their bytes", async () => {
  const publisher = publisherFixture();
  const state = stateWith(publisher);
  const inspection = new AgentPiContextInspection();
  const snapshots = [];
  for (const data of ["first-private-image", "second-private-image", "first-private-image"]) {
    snapshots.push(
      await inspection.capture({
        context: {
          messages: [{ role: "user", timestamp: 1, content: [{ type: "image", mimeType: "image/png", data }] }],
        },
        model: "test-model",
        scope: "native",
        state,
      }),
    );
  }
  expect(snapshots[0]!.sections[0]!.id).not.toBe(snapshots[1]!.sections[0]!.id);
  expect(snapshots[0]!.sections[0]!.id).toBe(snapshots[2]!.sections[0]!.id);
  expect(publisher.publishBytes).toHaveBeenCalledTimes(2);
  expect(publisher.contents.join("\n")).not.toContain("private-image");
});

test("collector persists the exact request snapshot, provider usage and failure outcome together", async () => {
  const state = createTurnState("test-model");
  const snapshot = await new AgentPiContextInspection().capture({
    context: { messages: [] },
    model: "test-model",
    scope: "native",
    state,
  });
  const index = state.beginModelRequest();
  state.modelContexts.set(index, Promise.resolve(snapshot));
  const events: AgentDomainEvent[] = [];
  const collector = new AgentPiRunCollector({
    requestId: "request",
    step: 1,
    turnState: state,
    onEvent: (event) => {
      events.push(event);
    },
  });
  const message = failureMessage(
    projectSeneraModelProviderToPi(createModelProvider()).model,
    "Provider rejected request",
  );
  message.usage = { ...message.usage, input: 80, cacheRead: 20, totalTokens: 100 };
  await collector.collect({ type: "message_start", message });
  await collector.collect({ type: "message_end", message });
  expect(events.find((event) => event.kind === AgentEventKinds.ModelStarted)?.data).toMatchObject({
    messageIndex: index,
    contextSnapshot: snapshot,
  });
  expect(events.find((event) => event.kind === AgentEventKinds.ModelCompleted)?.data).toMatchObject({
    messageIndex: index,
    outcome: "failed",
    errorMessage: "Provider rejected request",
    usage: { inputTokens: 80, cacheReadTokens: 20, totalTokens: 100, source: "provider_reported" },
  });
});

test("slow inspection storage never holds the provider transport", async () => {
  let release!: () => void;
  const waitForStorage = new Promise<void>((resolve) => {
    release = resolve;
  });
  const publisher = publisherFixture();
  const state = stateWith({
    publishBytes: async (input) => {
      await waitForStorage;
      return publisher.publishBytes(input);
    },
  });
  const modelProvider = createModelProvider({
    ToolPlanningMode: "native",
    Endpoint: "Responses",
    Capabilities: { ToolCalling: true },
  });
  const projection = projectSeneraModelProviderToPi(modelProvider);
  const provider = new AgentPiNativeToolProvider({
    projection,
    modelProvider,
    frame: createFrame(state, "session", "request"),
    apiStreams: nativeApiStreams((model) => completedStream(model, [{ type: "text", text: "Ready" }])),
  }).create();
  try {
    const result = await provider
      .streamSimple(provider.getModels()[0]!, {
        messages: [{ role: "user", content: "Hello", timestamp: 1 }],
        tools: [tool("ToolSearch")],
      })
      .result();
    expect(result.stopReason, result.errorMessage).not.toBe("error");
    expect(publisher.publishBytes).not.toHaveBeenCalled();
  } finally {
    release();
  }
  expect((await state.modelContexts.get(0))?.sections[0]?.resourceUri).toBeDefined();
});

test("snapshot input cannot grow when Pi appends messages during publication", async () => {
  const publisher = publisherFixture();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const state = stateWith({
    publishBytes: async (input) => {
      await pending;
      return publisher.publishBytes(input);
    },
  });
  const context: Context = { messages: [{ role: "user", timestamp: 1, content: "Original request" }] };
  const snapshot = new AgentPiContextInspection().capture({ context, model: "test-model", scope: "native", state });
  context.messages.push({ role: "user", timestamp: 2, content: "Later request" });
  release();
  expect((await snapshot).sections).toHaveLength(1);
  expect(publisher.contents.join("\n")).not.toContain("Later request");
});
