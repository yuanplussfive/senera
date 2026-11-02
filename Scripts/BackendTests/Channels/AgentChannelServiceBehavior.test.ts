import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, test, afterEach, vi } from "vitest";
import {
  AgentChannelService,
  type AgentChannelSessionPort,
  type AgentChannelServiceOptions,
  type AgentChannelStatus,
} from "../../../Source/AgentSystem/Channels/AgentChannelService.js";
import type {
  AgentChannelAdapter,
  AgentChannelAdapterHandlers,
  AgentChannelConfig,
  AgentChannelConnectionState,
  AgentChannelInboundMessage,
  AgentChannelKind,
  AgentChannelsConfig,
} from "../../../Source/AgentSystem/Channels/AgentChannelTypes.js";
import { resolveAgentChannelsConfig } from "../../../Source/AgentSystem/Channels/AgentChannelsConfig.js";
import { AgentChannelSessionMappingStore } from "../../../Source/AgentSystem/Channels/AgentChannelSessionMappingStore.js";
import { AgentChannelParticipationStore } from "../../../Source/AgentSystem/Channels/AgentChannelParticipationStore.js";
import { AgentChannelIngress } from "../../../Source/AgentSystem/Channels/AgentChannelIngress.js";
import { AgentChannelOutbox } from "../../../Source/AgentSystem/Channels/AgentChannelOutbox.js";
import { resolveAgentChannelSessionId } from "../../../Source/AgentSystem/Channels/AgentChannelSessionIdentity.js";
import { AgentChannelWebhookApi } from "../../../Source/AgentSystem/Channels/AgentChannelWebhookApi.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { AgentInteractionContext } from "../../../Source/AgentSystem/Interaction/AgentInteractionContext.js";
import { AgentInteractionSurfaces } from "../../../Source/AgentSystem/Interaction/AgentInteractionContext.js";
import { AgentChannelKinds } from "../../../Source/AgentSystem/Channels/AgentChannelTypes.js";
import { createAgentResourceUri } from "../../../Source/AgentSystem/Resources/AgentResourceUri.js";
import { cleanupChannelsTestRoots, openChannelsTestDatabase, TestChannelSource } from "./AgentChannelTestSupport.js";

afterEach(() => cleanupChannelsTestRoots());

interface FakeSessionMemory {
  readonly submissions: Array<{
    sessionId: string;
    input: string;
    approvalMode: string;
    modelProviderId?: string;
    queueMode?: string;
    requestId?: string;
    interaction?: AgentInteractionContext;
    metadata?: Record<string, unknown>;
    attachments?: readonly { readonly resourceUri: string; readonly name: string; readonly mime: string }[];
  }>;
  readonly cancellations: string[];
  readonly steers: Array<{ sessionId: string; input: string; interaction?: AgentInteractionContext }>;
  readonly activeRuns: Set<string>;
  submissionOutcome: "accepted" | "queued" | "busy";
}

function createMemory(): FakeSessionMemory {
  return {
    submissions: [],
    cancellations: [],
    steers: [],
    activeRuns: new Set(),
    submissionOutcome: "accepted",
  };
}

function fakeSessionPort(memory: FakeSessionMemory): AgentChannelSessionPort {
  return {
    acceptMessage: async (request) => {
      memory.submissions.push({
        sessionId: request.sessionId,
        input: request.input,
        approvalMode: request.approvalMode,
        modelProviderId: request.modelProviderId,
        queueMode: request.queueMode,
        requestId: request.requestId,
        interaction: request.interaction,
        metadata: request.metadata,
        attachments: request.attachments,
      });
      if (memory.submissionOutcome !== "accepted") {
        return { kind: memory.submissionOutcome };
      }
      // Admit and publish a terminal run without holding the ingress request open.
      if (request.onEvent) {
        await request.onEvent({
          kind: "run.started",
          context: { requestId: request.requestId, sessionId: request.sessionId },
          data: {},
        } as never);
        await request.onEvent({
          kind: "run.completed",
          context: { requestId: request.requestId, sessionId: request.sessionId },
          data: {},
        } as never);
      }
      return { kind: "accepted" };
    },
    cancelActiveRun: async () => true,
    requestActiveRunCancellation: async ({ sessionId }) => {
      memory.cancellations.push(sessionId);
      return true;
    },
    steerActiveRun: async ({ sessionId, input, interaction }) => {
      memory.steers.push({ sessionId, input, interaction });
      return memory.activeRuns.has(sessionId);
    },
    hasActiveRun: (sessionId) => memory.activeRuns.has(sessionId),
  };
}

function fakeAdapter(
  channel: { sends: string[] },
  kind: AgentChannelKind = "telegram",
  automaticDelivery?: boolean,
): AgentChannelAdapter {
  return {
    kind,
    capabilities: {
      splitsLongMessages: true,
      maxMessageLength: 4096,
      supportsEdit: false,
      supportsDraft: false,
      markdown: "plain",
      commandPrefix: "/",
      ...(automaticDelivery === undefined ? {} : { automaticDelivery }),
    },
    bind: () => undefined,
    connect: async () => undefined,
    disconnect: async () => undefined,
    getConnectionState: () => "connected",
    send: async (source, content) => {
      channel.sends.push(`${source.chatId} :: ${content}`);
      return { kind: "sent", messageId: `m${channel.sends.length}` };
    },
    handleWebhookUpdate: async (payload) => {
      const body = payload as { message?: { chat?: { id?: number }; from?: { id?: number }; text?: string } };
      return body?.message !== undefined;
    },
  };
}

function fakeRegistry(channel: { sends: string[] }, kind: AgentChannelKind = "telegram", automaticDelivery?: boolean) {
  let created = 0;
  return {
    kinds: () => [kind],
    create: () => {
      created += 1;
      void created;
      return fakeAdapter(channel, kind, automaticDelivery);
    },
  };
}

function baseConfiguration(overrides?: {
  webhookSecret?: string;
  busyMessageMode?: "steer" | "follow_up";
}): Record<string, unknown> {
  return {
    enabled: true,
    defaultApprovalMode: "agent",
    ...(overrides?.busyMessageMode ? { busyMessageMode: overrides.busyMessageMode } : {}),
    telegram: {
      enabled: true,
      token: "tok",
      allowedUsers: ["222222222"],
      webhookSecret: overrides?.webhookSecret,
    },
    qq: { enabled: false },
    discord: { enabled: false },
  };
}

function baseConfig(overrides?: {
  webhookSecret?: string;
  busyMessageMode?: "steer" | "follow_up";
}): AgentSystemConfig {
  return {
    DefaultModelProviderId: "main",
    Extensions: {
      "agent-channels": {
        Configuration: baseConfiguration(overrides),
      },
    },
  } as unknown as AgentSystemConfig;
}

function baseConfigWithProfileRoutes(profileRoutes: readonly Record<string, unknown>[]): AgentSystemConfig {
  return {
    ...baseConfig(),
    Extensions: {
      "agent-channels": {
        Configuration: {
          ...baseConfiguration(),
          profileRoutes,
        },
      },
    },
  } as unknown as AgentSystemConfig;
}

function channelsConfig(overrides?: Parameters<typeof baseConfig>[0]): AgentChannelsConfig {
  return resolveAgentChannelsConfig(baseConfig(overrides));
}

interface ServiceInternals {
  handleInbound(channel: never, message: AgentChannelInboundMessage): Promise<void>;
  pumpParticipant(sessionId: string): Promise<void>;
  active: Map<AgentChannelKind, { adapter: AgentChannelAdapter; config: AgentChannelConfig }>;
}

function internals(service: AgentChannelService): ServiceInternals {
  return service as unknown as ServiceInternals;
}

async function runService(
  config: () => AgentChannelsConfig,
  options?: { onEvent?: AgentChannelServiceOptions["onEvent"]; memory?: FakeSessionMemory },
) {
  const memory = options?.memory ?? createMemory();
  const sends: string[] = [];
  const service = new AgentChannelService({
    config,
    registry: fakeRegistry({ sends }) as never,
    sessionManager: fakeSessionPort(memory),
    mappingStore: undefined,
    onEvent: options?.onEvent,
    onLog: () => undefined,
  });
  await service.start();
  return { service, memory, sends, internals: internals(service) };
}

async function participationFixture(options?: {
  submissionOutcome?: FakeSessionMemory["submissionOutcome"];
  resourceResolver?: AgentChannelServiceOptions["resourceResolver"];
}) {
  const database = openChannelsTestDatabase();
  const store = new AgentChannelParticipationStore(database.connection);
  const memory = createMemory();
  memory.submissionOutcome = options?.submissionOutcome ?? "accepted";
  const sends: string[] = [];
  const current = channelsConfig();
  const adapter: AgentChannelAdapter = {
    ...fakeAdapter({ sends }, "onebot11", false),
    conversationContext: () => ({
      id: "10",
      name: "Private",
      selfId: "40",
      participants: [
        { id: "20", name: "User", kind: "user" },
        { id: "40", name: "Agent", kind: "agent" },
      ],
    }),
  };
  const service = new AgentChannelService({
    config: () => ({
      ...current,
      channels: {
        ...current.channels,
        telegram: { ...current.channels.telegram, enabled: false },
        onebot11: { ...current.channels.onebot11, enabled: true, allowAllUsers: true },
      },
    }),
    registry: { kinds: () => ["onebot11"], create: () => adapter } as never,
    sessionManager: fakeSessionPort(memory),
    mappingStore: new AgentChannelSessionMappingStore(database.connection),
    participationStore: store,
    inboxBudget: () => ({ pageSize: 40, fits: () => true }),
    resourceResolver: options?.resourceResolver,
    outbox: new AgentChannelOutbox(database.connection),
  });
  await service.start();
  const channel = internals(service).active.get("onebot11")!;
  const source = { platform: AgentChannelKinds.OneBot11, chatType: "direct" as const, chatId: "10", userId: "20" };
  await internals(service).handleInbound(channel as never, {
    source: { ...source, messageId: "1" },
    senderId: "20",
    text: "first",
  });
  const first = memory.submissions[0]!;
  const context = { sessionId: first.sessionId, requestId: first.requestId!, interaction: first.interaction! };
  const append = (id: string, senderId = "20", segments?: AgentChannelInboundMessage["segments"]) =>
    store.append({
      source: { ...source, messageId: id },
      senderId,
      text: `message ${id}`,
      ...(segments ? { segments } : {}),
    });
  return {
    service,
    store,
    memory,
    sends,
    context,
    append,
    close: async () => {
      await service.stop();
      database.close();
    },
  };
}

describe("channel service", () => {
  test("a repeated native input retains its captured session after /new", async () => {
    const database = openChannelsTestDatabase();
    const mappingStore = new AgentChannelSessionMappingStore(database.connection);
    const ingress = new AgentChannelIngress(database.connection);
    const memory = createMemory();
    const message = { source: { ...TestChannelSource, messageId: "old-message" }, text: "old task" };
    const now = new Date().toISOString();
    mappingStore.upsert(TestChannelSource, "old-session", 1, now);
    ingress.capture(message, [{ source: TestChannelSource, sessionId: "old-session" }]);
    mappingStore.resetEpoch(TestChannelSource, "new-session", 2, now);
    const service = new AgentChannelService({
      config: () => channelsConfig(),
      registry: fakeRegistry({ sends: [] }) as never,
      sessionManager: fakeSessionPort(memory),
      mappingStore,
      ingress,
    });
    await service.start();
    try {
      const channel = internals(service).active.get("telegram")!;
      await internals(service).handleInbound(channel as never, message);
      expect(memory.submissions).toEqual([]);
      expect(ingress.capture(message, []).state).toBe("discarded");
    } finally {
      await service.stop();
      database.close();
    }
  });

  test("preserves ambient group history with no current observer", async () => {
    const database = openChannelsTestDatabase();
    const participationStore = new AgentChannelParticipationStore(database.connection);
    const memory = createMemory();
    const adapter: AgentChannelAdapter = { ...fakeAdapter({ sends: [] }, "onebot11", false), observeInbound: () => [] };
    const current = channelsConfig();
    const service = new AgentChannelService({
      config: () => ({
        ...current,
        channels: {
          ...current.channels,
          onebot11: { ...current.channels.onebot11, enabled: true, allowAllUsers: true },
        },
      }),
      registry: { kinds: () => ["onebot11"], create: () => adapter } as never,
      sessionManager: fakeSessionPort(memory),
      participationStore,
      ingress: new AgentChannelIngress(database.connection),
    });
    await service.start();
    try {
      const source = {
        ...TestChannelSource,
        platform: AgentChannelKinds.OneBot11,
        chatType: "group" as const,
        messageId: "ambient",
      };
      await internals(service).handleInbound(internals(service).active.get("onebot11") as never, {
        source,
        text: "group conversation",
      });
      participationStore.ensure("later-member", source);
      expect(participationStore.read("later-member", 10).entries.map(({ message }) => message.text)).toEqual([
        "group conversation",
      ]);
      expect(memory.submissions).toEqual([]);
    } finally {
      await service.stop();
      database.close();
    }
  });

  test("official QQ uses explicit sends and a durable inbox without waking itself", async () => {
    const database = openChannelsTestDatabase();
    const store = new AgentChannelParticipationStore(database.connection);
    const memory = createMemory();
    const sends: string[] = [];
    const adapter: AgentChannelAdapter = {
      ...fakeAdapter({ sends }, AgentChannelKinds.Qq, false),
      capabilities: {
        ...fakeAdapter({ sends }, AgentChannelKinds.Qq, false).capabilities,
        supportsMentions: false,
        inboundEvents: ["message", "mention"],
      },
    };
    const current = channelsConfig();
    const service = new AgentChannelService({
      config: () => ({
        ...current,
        channels: {
          ...current.channels,
          telegram: { ...current.channels.telegram, enabled: false },
          qq: { ...current.channels.qq, enabled: true, allowAllUsers: true },
        },
      }),
      registry: { kinds: () => [AgentChannelKinds.Qq], create: () => adapter } as never,
      sessionManager: fakeSessionPort(memory),
      mappingStore: new AgentChannelSessionMappingStore(database.connection),
      participationStore: store,
      inboxBudget: () => ({ pageSize: 40, fits: () => true }),
    });
    const source = { platform: AgentChannelKinds.Qq, chatType: "group" as const, chatId: "group", userId: "group" };
    try {
      await service.start();
      const channel = internals(service).active.get(AgentChannelKinds.Qq)!;
      await internals(service).handleInbound(channel as never, {
        source: { ...source, messageId: "inbound-1" },
        senderId: "verified-user",
        text: "hello",
        addressedToSelf: true,
      });
      const first = memory.submissions[0]!;
      const context = { sessionId: first.sessionId, requestId: first.requestId!, interaction: first.interaction! };
      expect(first.interaction).toMatchObject({
        delivery: "explicit",
        message: { senderId: "verified-user" },
        capabilities: { automaticDelivery: false, supportsMentions: false },
      });
      expect(sends).toEqual([]);
      await expect(service.waitForMessage({ ...context, conditions: { events: ["poke"] } })).rejects.toThrow(
        "supports these wait events",
      );
      await expect(service.send({ ...context, messages: ["hello"], mentionIds: ["verified-user"] })).rejects.toThrow(
        "does not support native mentions",
      );
      await expect(
        service.waitForMessage({ ...context, conditions: { events: ["message"], senderIds: ["unverified-user"] } }),
      ).rejects.toThrow("verified participants");
      expect(await service.send({ ...context, messages: ["authored reply"] })).toEqual({
        status: "sent",
        messageIds: ["m1"],
      });
      expect(await service.send({ ...context, messages: ["second message"] })).toEqual({
        status: "sent",
        messageIds: ["m2"],
      });
      expect(sends).toEqual(["group :: authored reply", "group :: second message"]);
      const outgoing = await service.readHistory({ ...context, afterSequence: 0, limit: 40 });
      expect(outgoing.entries.map(({ message }) => message.text)).toEqual([
        "hello",
        "authored reply",
        "second message",
      ]);
      expect(outgoing.entries[1]?.message.task).toMatchObject({
        sessionId: first.sessionId,
        requestId: first.requestId,
      });
      const waiting = await service.waitForMessage({
        ...context,
        conditions: { events: ["mention"], senderIds: ["verified-user"] },
      });
      expect(waiting.status).toBe("waiting");
      await internals(service).pumpParticipant(first.sessionId);
      expect(memory.submissions).toHaveLength(1);
      await internals(service).handleInbound(channel as never, {
        source: { ...source, messageId: "inbound-2" },
        senderId: "another-user",
        text: "@bot",
        addressedToSelf: true,
      });
      expect(memory.submissions).toHaveLength(2);
      expect(memory.submissions[1]?.sessionId).toBe(first.sessionId);
      expect(memory.submissions[1]?.interaction).toMatchObject({
        message: { senderId: "another-user" },
        wake: { reason: "event" },
      });
      expect(sends).toHaveLength(2);
    } finally {
      await service.stop();
      database.close();
    }
  });

  test("keeps historical inbox media attached to its event instead of a later text-only message", async () => {
    const fixture = await participationFixture();
    try {
      const participant = fixture.store.get(fixture.context.sessionId)!;
      const image = {
        resourceUri: createAgentResourceUri("k7m4p9"),
        name: "earlier.png",
        mime: "image/png",
        size: 16,
        status: "uploaded" as const,
      };
      fixture.store.append(
        {
          source: { ...participant.source, messageId: "2" },
          senderId: "40",
          text: "earlier image",
          segments: [{ type: "image", data: { resourceUri: image.resourceUri } }],
        },
        [image],
      );
      fixture.append("3");
      await internals(fixture.service).pumpParticipant(fixture.context.sessionId);
      const current = fixture.memory.submissions.at(-1)!;
      expect(current.input).toBe("message 3");
      expect(current.attachments).toBeUndefined();
      expect(current.interaction?.inbox?.entries[0]?.attachments).toEqual([image]);
      expect(current.interaction?.inbox?.entries[0]?.message.senderId).toBe("40");
      expect(current.interaction?.inbox?.entries[1]?.message.text).toBe("message 3");
    } finally {
      await fixture.close();
    }
  });

  test("delivers complete unread context with the wake and leaves rejected turns unread", async () => {
    const fixture = await participationFixture({ submissionOutcome: "busy" });
    try {
      expect(fixture.context.interaction.inbox).toMatchObject({ afterSequence: 0, throughSequence: 1, hasMore: false });
      expect(fixture.context.interaction.inbox?.entries[0]?.message.text).toBe("first");
      expect(fixture.store.get(fixture.context.sessionId)?.cursor).toBe(0);
    } finally {
      await fixture.close();
    }
  });

  test("keeps batch items distinct and replays their durable receipts without sending again", async () => {
    const fixture = await participationFixture();
    try {
      const input = { ...fixture.context, toolCallId: "text-batch", messages: ["first", "second", "third"] };
      const expected = { status: "sent", messageIds: ["m1", "m2", "m3"] };
      expect(await fixture.service.send(input)).toEqual(expected);
      expect(await fixture.service.send(input)).toEqual(expected);
      expect(fixture.sends).toEqual(["10 :: first", "10 :: second", "10 :: third"]);
    } finally {
      await fixture.close();
    }
  });

  test("pauses the rest of a text batch when new activity arrives after its first delivery", async () => {
    const fixture = await participationFixture();
    try {
      const adapter = internals(fixture.service).active.get("onebot11")!.adapter;
      const send = adapter.send.bind(adapter);
      vi.spyOn(adapter, "send").mockImplementation(async (...args) => {
        const result = await send(...args);
        fixture.append("2");
        return result;
      });
      const receipt = await fixture.service.send({
        ...fixture.context,
        messages: ["first part", "outdated second part", "outdated third part"],
      });
      expect(receipt).toMatchObject({
        status: "needs_review",
        messageIds: ["m1"],
        inbox: {
          entries: expect.arrayContaining([
            expect.objectContaining({ message: expect.objectContaining({ text: "message 2" }) }),
          ]),
        },
      });
      expect(fixture.sends).toEqual(["10 :: first part"]);
    } finally {
      await fixture.close();
    }
  });

  test("retains confirmed text delivery when history persistence fails", async () => {
    const fixture = await participationFixture();
    try {
      vi.spyOn(fixture.store, "append").mockImplementation(() => {
        throw new Error("history storage unavailable");
      });
      expect(await fixture.service.send({ ...fixture.context, messages: ["delivered", "not sent"] })).toEqual({
        status: "failed",
        messageIds: ["m1"],
        code: "history_failed",
        error: "history storage unavailable",
      });
      expect(fixture.sends).toEqual(["10 :: delivered"]);
    } finally {
      await fixture.close();
    }
  });

  test("parallel reads cannot authorize sends until their results reach the next model decision", async () => {
    const fixture = await participationFixture();
    try {
      fixture.append("2");
      const batch = { ...fixture.context, batchId: "batch-1" };
      const [history, first, second] = await Promise.all([
        fixture.service.readHistory({ ...batch, limit: 40 }),
        fixture.service.send({ ...batch, messages: ["obsolete answer"] }),
        fixture.service.send({ ...batch, messages: ["another obsolete answer"] }),
      ]);
      expect(history.entries.map((entry) => entry.message.text)).toEqual(["message 2"]);
      expect(first.status).toBe("needs_review");
      expect(second.status).toBe("needs_review");
      expect(fixture.sends).toEqual([]);
      const next = await fixture.service.send({ ...fixture.context, batchId: "batch-2", messages: ["updated answer"] });
      expect(next).toMatchObject({ status: "sent", messageIds: ["m1"] });
      fixture.append("3");
      expect(
        await fixture.service.send({
          ...fixture.context,
          batchId: "batch-3",
          messages: ["independent contribution"],
          allowUnread: true,
        }),
      ).toMatchObject({ status: "sent", messageIds: ["m2"] });
      expect(fixture.store.get(fixture.context.sessionId)?.cursor).toBe(2);
      fixture.append("4", "40");
      await fixture.service.readHistory({ ...fixture.context, limit: 40 });
      fixture.append("5", "40");
      expect(
        await fixture.service.send({ ...fixture.context, batchId: "batch-4", messages: ["follow-up"] }),
      ).toMatchObject({ status: "sent" });
    } finally {
      await fixture.close();
    }
  });

  test("new matching activity is reviewed before waiting, while unmatched activity remains readable", async () => {
    const fixture = await participationFixture();
    try {
      fixture.append("2", "20", [{ type: "at", data: { qq: "40" } }]);
      const conditions = { events: ["mention"] as const };
      const review = await fixture.service.waitForMessage({ ...fixture.context, batchId: "batch-1", conditions });
      expect(review).toMatchObject({ status: "needs_review", inbox: { throughSequence: 2 } });
      expect(fixture.store.get(fixture.context.sessionId)?.status).toBe("active");
      fixture.append("3");
      const waiting = await fixture.service.waitForMessage({ ...fixture.context, batchId: "batch-2", conditions });
      expect(waiting.status).toBe("waiting");
      expect(fixture.store.read(fixture.context.sessionId, 40).entries.map((entry) => entry.message.text)).toEqual([
        "message 3",
      ]);
    } finally {
      await fixture.close();
    }
  });

  test("media delivery checks for new conversation activity after asynchronous resource resolution", async () => {
    let release!: () => void;
    const resolved = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = await participationFixture({
      resourceResolver: {
        resolve: async () => undefined,
        resolveWorkspacePath: async () => {
          await resolved;
          return {
            filePath: "E:/workspace/image.png",
            name: "image.png",
            mime: "image/png",
            size: 10,
            sha256: "test",
          } as never;
        },
      },
    });
    try {
      const pending = fixture.service.sendMedia({
        ...fixture.context,
        batchId: "media",
        resource: "image.png",
        kind: "image",
      });
      fixture.append("2");
      release();
      expect((await pending).status).toBe("needs_review");
      expect(fixture.sends).toEqual([]);
    } finally {
      release();
      await fixture.close();
    }
  });

  test("starts the local channel while an independent remote handshake is pending", async () => {
    let finishRemote!: () => void;
    const remoteHandshake = new Promise<void>((resolve) => {
      finishRemote = resolve;
    });
    const localConnected = vi.fn();
    const remote = fakeAdapter({ sends: [] }, AgentChannelKinds.Telegram);
    const local = fakeAdapter({ sends: [] }, AgentChannelKinds.OneBot11);
    remote.connect = () => remoteHandshake;
    local.connect = async () => {
      localConnected();
    };
    const config = channelsConfig();
    const service = new AgentChannelService({
      config: () => ({
        ...config,
        channels: { ...config.channels, onebot11: { ...config.channels.onebot11, enabled: true } },
      }),
      registry: {
        kinds: () => [AgentChannelKinds.Telegram, AgentChannelKinds.OneBot11],
        create: (kind: AgentChannelKind) => (kind === AgentChannelKinds.OneBot11 ? local : remote),
      } as never,
      sessionManager: fakeSessionPort(createMemory()),
    });
    const starting = service.start();
    try {
      await vi.waitFor(() => expect(localConnected).toHaveBeenCalledOnce());
    } finally {
      finishRemote();
      await starting;
      await service.stop();
    }
  });

  test("a persisted overdue wait resumes once as host activity after restarting", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-10-25T08:00:00+08:00"));
    const database = openChannelsTestDatabase();
    const memory = createMemory();
    const current = channelsConfig();
    const service = new AgentChannelService({
      config: () => ({
        ...current,
        channels: {
          ...current.channels,
          telegram: { ...current.channels.telegram, enabled: false },
          onebot11: { ...current.channels.onebot11, enabled: true, allowAllUsers: true },
        },
      }),
      registry: fakeRegistry({ sends: [] }, "onebot11", false) as never,
      sessionManager: fakeSessionPort(memory),
      mappingStore: new AgentChannelSessionMappingStore(database.connection),
      participationStore: new AgentChannelParticipationStore(database.connection),
      inboxBudget: () => ({ pageSize: 40, fits: () => true }),
    });
    const interaction: AgentInteractionContext = { surface: "channel", platform: "onebot11" };
    try {
      await service.start();
      const channel = internals(service).active.get("onebot11")!;
      await internals(service).handleInbound(channel as never, {
        source: { platform: "onebot11", chatType: "direct", chatId: "10", userId: "20", messageId: "1" },
        text: "later",
      });
      const first = memory.submissions[0]!;
      await service.readHistory({ sessionId: first.sessionId, requestId: first.requestId, interaction, limit: 40 });
      await service.waitForMessage({
        sessionId: first.sessionId,
        requestId: first.requestId,
        interaction,
        conditions: { events: [], wakeAt: "2026-10-25T08:01:00+08:00" },
      });
      await service.stop();
      expect(vi.getTimerCount()).toBe(0);
      vi.setSystemTime(new Date("2026-10-25T08:02:00+08:00"));
      await service.start();
      await internals(service).pumpParticipant(first.sessionId);
      expect(memory.submissions).toHaveLength(2);
      expect(memory.submissions[1]).toMatchObject({ input: "", interaction: { wake: { reason: "time" } } });
      expect(memory.submissions[1]?.interaction?.message).toBeUndefined();
      await expect(
        service.waitForMessage({
          sessionId: first.sessionId,
          requestId: first.requestId,
          interaction,
          conditions: { events: [], wakeAt: "2026-10-25T08:01:00+08:00" },
        }),
      ).rejects.toThrow("must be in the future");
      await internals(service).pumpParticipant(first.sessionId);
      expect(memory.submissions).toHaveLength(2);
    } finally {
      await service.stop();
      database.close();
      vi.useRealTimers();
    }
  });
  test("group members decide independently, coalesce a busy inbox, and revoke removed members", async () => {
    const database = openChannelsTestDatabase();
    const mappings = new AgentChannelSessionMappingStore(database.connection);
    const participation = new AgentChannelParticipationStore(database.connection);
    const memory = createMemory();
    const sends: string[] = [];
    const members = new Set(["agent-a", "agent-b"]);
    const source = { platform: AgentChannelKinds.OneBot11, chatType: "group" as const, chatId: "10", userId: "20" };
    let handlers: AgentChannelAdapterHandlers | undefined;
    let busy = false;
    let finishIdle!: () => void;
    const idle = new Promise<void>((resolve) => {
      finishIdle = resolve;
    });
    const adapter: AgentChannelAdapter = {
      ...fakeAdapter({ sends }, "onebot11", false),
      bind: (value) => {
        handlers = value;
      },
      routeInbound: (message) =>
        [...members].filter((id) => id !== message.senderId).map((agentId) => ({ ...message.source, agentId })),
      canParticipate: (lane) => Boolean(lane.agentId && members.has(lane.agentId)),
      conversationContext: (lane) => ({
        id: "10",
        name: "Group",
        selfId: lane.agentId!,
        participants: [
          { id: "20", name: "User", kind: "user" },
          { id: "agent-a", name: "Alice", kind: "agent" },
          { id: "agent-b", name: "Bob", kind: "agent" },
        ],
      }),
    };
    const current = channelsConfig();
    const sessionPort = fakeSessionPort(memory);
    sessionPort.hasActiveRun = () => busy;
    sessionPort.waitForIdle = () => idle;
    const service = new AgentChannelService({
      config: () => ({
        ...current,
        channels: {
          ...current.channels,
          telegram: { ...current.channels.telegram, enabled: false },
          onebot11: { ...current.channels.onebot11, enabled: true, allowAllUsers: true },
        },
      }),
      registry: { kinds: () => ["onebot11"], create: () => adapter } as never,
      sessionManager: sessionPort,
      mappingStore: mappings,
      participationStore: participation,
      inboxBudget: () => ({ pageSize: 40, fits: () => true }),
    });
    const inbound = (id: string, text: string, senderId = "20", segments?: AgentChannelInboundMessage["segments"]) =>
      handlers!.onMessage({ source: { ...source, messageId: id }, senderId, text, ...(segments ? { segments } : {}) });
    const interaction: AgentInteractionContext = { surface: "channel", platform: "onebot11", chatType: "group" };
    await service.start();
    try {
      await inbound("1", "start");
      expect(memory.submissions).toHaveLength(2);
      expect(new Set(memory.submissions.map((request) => request.sessionId)).size).toBe(2);
      busy = true;
      const arrivals = [inbound("2", "first"), inbound("3", "second"), inbound("4", "latest")];
      await vi.waitFor(() =>
        expect(participation.read(memory.submissions[0]!.sessionId, 40, 0).entries).toHaveLength(4),
      );
      busy = false;
      finishIdle();
      await Promise.all(arrivals);
      expect(memory.submissions).toHaveLength(4);
      expect(memory.submissions.slice(2).map((request) => request.input)).toEqual(["latest", "latest"]);
      const first = memory.submissions.find((request) => request.interaction?.conversation?.selfId === "agent-a")!;
      expect(first.metadata).toMatchObject({ channel: { platform: "onebot11", chatName: "Group" } });
      await service.readHistory({ sessionId: first.sessionId, requestId: first.requestId, interaction, limit: 40 });
      await service.waitForMessage({
        sessionId: first.sessionId,
        requestId: first.requestId,
        interaction,
        conditions: { events: ["mention"] },
      });
      await inbound("5", "peer invitation", "agent-b", [{ type: "at", data: { qq: "agent-a" } }]);
      expect(memory.submissions).toHaveLength(5);
      expect(memory.submissions.at(-1)?.interaction?.message?.senderKind).toBe("agent");
      expect(memory.submissions.at(-1)?.interaction?.conversation?.selfId).toBe("agent-a");
      members.delete("agent-a");
      await handlers?.onParticipantsChanged?.();
      expect(participation.get(first.sessionId)).toMatchObject({ status: "paused" });
      expect(memory.cancellations).toContain(first.sessionId);
      await expect(
        service.send({ sessionId: first.sessionId, requestId: first.requestId, interaction, messages: ["late reply"] }),
      ).rejects.toThrow("no longer an enabled participant");
    } finally {
      await service.stop();
      database.close();
    }
  });
  test("attaches host sockets to the live embedded OneBot protocol and rejects them when stopped", async () => {
    const sends: string[] = [];
    const current = channelsConfig();
    const service = new AgentChannelService({
      config: () => ({
        ...current,
        channels: {
          ...current.channels,
          telegram: { ...current.channels.telegram, enabled: false },
          onebot11: {
            ...current.channels.onebot11,
            enabled: true,
          },
        },
      }),
      registry: fakeRegistry({ sends }, AgentChannelKinds.OneBot11, false) as never,
      sessionManager: fakeSessionPort(createMemory()),
      onLog: () => undefined,
    });
    await service.start();
    const active = internals(service).active.get(AgentChannelKinds.OneBot11);
    if (!active) throw new Error("OneBot adapter did not start.");
    const connectClient = vi.fn();
    active.adapter.connectClient = connectClient;
    const socket = { close: vi.fn() };
    const request = {} as IncomingMessage;
    service.connectOneBot11Client(socket as never, request);
    expect(connectClient).toHaveBeenCalledWith(socket, request);
    await service.stop();
    service.connectOneBot11Client(socket as never, request);
    expect(connectClient).toHaveBeenCalledTimes(1);
    expect(socket.close).toHaveBeenCalledWith(1013, "OneBot channel is not connected");
  });

  test("persists a OneBot wait and resumes once with complete media history", async () => {
    const database = openChannelsTestDatabase();
    const mappingStore = new AgentChannelSessionMappingStore(database.connection);
    const participationStore = new AgentChannelParticipationStore(database.connection);
    const memory = createMemory();
    const sends: string[] = [];
    const resolvedAttachment = {
      resourceUri: createAgentResourceUri("v6q8t3"),
      name: "channel-image.png",
      mime: "image/png",
      size: 16,
      status: "uploaded" as const,
    };
    const resolvedAttachmentIds: string[] = [];
    const oneBotSource = {
      platform: AgentChannelKinds.OneBot11,
      chatType: "direct" as const,
      chatId: "local-chat",
      userId: "local-user",
      messageId: "1",
    };
    const current = channelsConfig();
    const service = new AgentChannelService({
      config: () => ({
        ...current,
        channels: {
          ...current.channels,
          telegram: { ...current.channels.telegram, enabled: false },
          onebot11: { ...current.channels.onebot11, enabled: true },
        },
      }),
      registry: fakeRegistry({ sends }, AgentChannelKinds.OneBot11, false) as never,
      sessionManager: fakeSessionPort(memory),
      mappingStore,
      participationStore,
      inboxBudget: () => ({ pageSize: 40, fits: () => true }),
      attachmentResolver: async (attachment) => {
        if (attachment.id) resolvedAttachmentIds.push(attachment.id);
        return resolvedAttachment;
      },
      onLog: () => undefined,
    });
    await service.start();
    try {
      const adapter = internals(service).active.get(AgentChannelKinds.OneBot11)!;
      await internals(service).handleInbound(adapter as never, { source: oneBotSource, text: "开始等待" });
      await vi.waitFor(() => expect(memory.submissions).toHaveLength(1));
      const sessionId = memory.submissions[0]!.sessionId;
      const requestId = memory.submissions[0]!.requestId;
      const interaction: AgentInteractionContext = {
        surface: AgentInteractionSurfaces.Channel,
        platform: AgentChannelKinds.OneBot11,
      };
      await vi.waitFor(() => expect(participationStore.get(sessionId)?.cursor).toBeGreaterThan(0));
      const firstPage = await service.readHistory({ sessionId, requestId, interaction, limit: 40 });
      expect(firstPage.entries).toHaveLength(0);
      expect(memory.submissions[0]?.interaction?.inbox?.entries[0]?.message.text).toBe("开始等待");

      const wait = await service.waitForMessage({
        sessionId,
        requestId,
        interaction,
        conditions: { events: ["message"] },
      });
      if (wait.status !== "waiting") throw new Error("The complete inbox should register a wait.");
      expect(wait.control).toEqual({ kind: "SuspendRun", reason: "channel-wait", id: wait.waitId });
      expect(participationStore.get(sessionId)?.status).toBe("waiting");
      await expect(
        service.waitForMessage({ sessionId, requestId, interaction, conditions: { events: ["message"] } }),
      ).rejects.toThrow("already registered");
      await internals(service).handleInbound(adapter as never, {
        source: { ...oneBotSource, messageId: "2" },
        text: "",
        segments: [
          { type: "image", data: { attachmentId: "source-image", url: "https://media.example.test/inbound.png" } },
        ],
        attachments: [
          {
            id: "source-image",
            url: "https://media.example.test/inbound.png",
            filename: "inbound.png",
            contentType: "image/png",
            mediaType: "image",
          },
        ],
      });
      await vi.waitFor(() => expect(memory.submissions).toHaveLength(2));
      await vi.waitFor(() => expect(participationStore.get(sessionId)?.cursor).toBeGreaterThan(1));
      expect(memory.submissions[1]?.interaction?.wake).toMatchObject({ reason: "event", waitId: wait.waitId });
      expect(memory.submissions[1]?.attachments).toEqual([resolvedAttachment]);
      const nextPage = await service.readHistory({ sessionId, requestId, interaction, limit: 40 });
      expect(nextPage.entries).toHaveLength(0);
      const delivered = memory.submissions[1]?.interaction?.inbox?.entries;
      expect(delivered).toHaveLength(1);
      expect(delivered?.[0]?.attachments).toEqual([resolvedAttachment]);
      expect(delivered?.[0]?.message.segments).toMatchObject([
        { type: "image", data: { resourceUri: resolvedAttachment.resourceUri } },
      ]);
      expect(resolvedAttachmentIds).toEqual(["source-image"]);
      expect((await service.readHistory({ sessionId, requestId, interaction, limit: 40 })).entries).toEqual([]);
      const aborted = new AbortController();
      aborted.abort(new Error("cancelled before registration"));
      await expect(
        service.waitForMessage({
          sessionId,
          requestId,
          interaction,
          conditions: { events: ["message"] },
          signal: aborted.signal,
        }),
      ).rejects.toThrow("cancelled before registration");
      await service.waitForMessage({ sessionId, requestId, interaction, conditions: { events: ["mention", "poke"] } });
      await service.stop();
      expect(participationStore.get(sessionId)?.status).toBe("waiting");
    } finally {
      await service.stop();
      database.close();
    }
  });

  test("rejects unauthorized users and allows listed ones", async () => {
    const { service, memory, sends, internals } = await runService(channelsConfig);
    const adapter = internals.active.get("telegram");
    expect(adapter).toBeDefined();

    await internals.handleInbound(adapter as never, {
      source: { ...TestChannelSource, userId: "999999999" },
      text: "hi",
    });
    expect(memory.submissions).toHaveLength(0);
    await delay(30);
    expect(sends.some((entry) => entry.includes("授权用户列表"))).toBe(true);

    await internals.handleInbound(adapter as never, { source: TestChannelSource, text: "hello world" });
    expect(memory.submissions).toHaveLength(1);
    expect(memory.submissions[0]?.input).toBe("hello world");
    expect(memory.submissions[0]?.queueMode).toBe("steer");
    await service.stop();
  });

  test("projects the current configured ProfileRoute into the channel interaction", async () => {
    const { service, memory, internals } = await runService(() =>
      resolveAgentChannelsConfig(
        baseConfigWithProfileRoutes([
          {
            id: "telegram-direct",
            selector: { surface: "channel", platform: "telegram", chatType: "direct" },
            profileId: "telegram-profile",
            modelProviderId: "channel-model",
          },
        ]),
      ),
    );
    const adapter = internals.active.get("telegram");

    await internals.handleInbound(adapter as never, { source: TestChannelSource, text: "hello" });

    expect(memory.submissions[0]?.interaction).toMatchObject({
      surface: "channel",
      platform: "telegram",
      profileId: "telegram-profile",
    });
    expect(memory.submissions[0]?.modelProviderId).toBe("channel-model");
    await service.stop();
  });

  test("routes commands without creating agent turns", async () => {
    const { service, memory, internals } = await runService(channelsConfig);
    const adapter = internals.active.get("telegram");
    await internals.handleInbound(adapter as never, { source: TestChannelSource, text: "/new" });
    await internals.handleInbound(adapter as never, { source: TestChannelSource, text: "/stop" });
    expect(memory.submissions).toHaveLength(0);
    expect(memory.cancellations).toHaveLength(1);
    await service.stop();
  });

  test("steers messages that join an active run without a sender-facing receipt", async () => {
    const memory = createMemory();
    memory.submissionOutcome = "queued";
    const { service, sends, internals } = await runService(channelsConfig, { memory });
    const adapter = internals.active.get("telegram");

    await internals.handleInbound(adapter as never, { source: TestChannelSource, text: "进度怎么样" });

    expect(memory.submissions).toHaveLength(1);
    expect(memory.submissions[0]?.queueMode).toBe("steer");
    await delay(30);
    expect(sends.some((entry) => entry.includes("已注入当前任务"))).toBe(false);
    expect(sends.some((entry) => entry.includes("已加入队列"))).toBe(false);
    await service.stop();
  });

  test("follow-up routing keeps legacy queue semantics silently", async () => {
    const memory = createMemory();
    memory.submissionOutcome = "queued";
    const { service, sends, internals } = await runService(() => channelsConfig({ busyMessageMode: "follow_up" }), {
      memory,
    });
    const adapter = internals.active.get("telegram");

    await internals.handleInbound(adapter as never, { source: TestChannelSource, text: "补充一下需求" });

    expect(memory.submissions[0]?.queueMode).toBe("follow_up");
    await delay(30);
    expect(sends.some((entry) => entry.includes("已注入当前任务"))).toBe(false);
    expect(sends.some((entry) => entry.includes("已加入队列"))).toBe(false);
    await service.stop();
  });

  test("notifies the sender when a busy submission is dropped", async () => {
    const memory = createMemory();
    memory.submissionOutcome = "busy";
    const { service, sends, internals } = await runService(channelsConfig, { memory });
    const adapter = internals.active.get("telegram");

    await expect(
      internals.handleInbound(adapter as never, { source: TestChannelSource, text: "现在能处理吗" }),
    ).rejects.toThrow("not accepted");

    expect(memory.submissions).toHaveLength(1);
    await delay(30);
    expect(sends.some((entry) => entry.includes("新消息会即时注入当前任务"))).toBe(true);
    await service.stop();
  });

  test("/queue reports an active run using the configured routing notice", async () => {
    const memory = createMemory();
    memory.activeRuns.add(resolveAgentChannelSessionId(TestChannelSource, 1));
    const { service, sends, internals } = await runService(channelsConfig, { memory });
    const adapter = internals.active.get("telegram");

    await internals.handleInbound(adapter as never, { source: TestChannelSource, text: "/queue" });
    await delay(30);
    expect(sends.some((entry) => entry.includes("新消息会即时注入当前任务"))).toBe(true);
    await service.stop();
  });

  test("/steer routes instructions through the session port when a run is active", async () => {
    const memory = createMemory();
    memory.activeRuns.add(resolveAgentChannelSessionId(TestChannelSource, 1));
    const { service, memory: usedMemory, sends, internals } = await runService(channelsConfig, { memory });
    const adapter = internals.active.get("telegram");

    await internals.handleInbound(adapter as never, { source: TestChannelSource, text: "/steer 先别做这个" });

    expect(usedMemory.steers).toEqual([
      {
        sessionId: resolveAgentChannelSessionId(TestChannelSource, 1),
        input: "先别做这个",
        interaction: expect.objectContaining({ surface: "channel", platform: "telegram", spaceId: expect.any(String) }),
      },
    ]);
    expect(usedMemory.submissions).toHaveLength(0);
    await delay(30);
    expect(sends.some((entry) => entry.includes("已将指令注入当前回合"))).toBe(true);
    await service.stop();
  });

  test("creates a new ephemeral lane and exposes its generated session id", async () => {
    const { service, memory, sends, internals } = await runService(channelsConfig);
    const adapter = internals.active.get("telegram");

    await internals.handleInbound(adapter as never, { source: TestChannelSource, text: "/new" });
    await delay(30);
    const firstReceipt = sends.find((entry) => entry.includes("ID: senera_channel_"));
    expect(firstReceipt).toBeDefined();

    await internals.handleInbound(adapter as never, { source: TestChannelSource, text: "first" });
    const firstSessionId = memory.submissions[0]?.sessionId;
    expect(firstSessionId).toMatch(/^senera_channel_/u);

    await internals.handleInbound(adapter as never, { source: TestChannelSource, text: "/new" });
    await delay(30);
    const receipts = sends.filter((entry) => entry.includes("ID: senera_channel_"));
    expect(receipts).toHaveLength(2);

    await internals.handleInbound(adapter as never, { source: TestChannelSource, text: "second" });
    const secondSessionId = memory.submissions[1]?.sessionId;
    expect(secondSessionId).toMatch(/^senera_channel_/u);
    expect(secondSessionId).not.toBe(firstSessionId);
    expect(receipts[1]).toContain(secondSessionId);
    await service.stop();
  });

  test("publishes channel-scoped run events for frontend observation", async () => {
    const events: Array<{ kind: string; context?: { scope?: { channel?: string } } }> = [];
    const { service, internals } = await runService(channelsConfig, {
      onEvent: (event) => {
        events.push(event as (typeof events)[number]);
      },
    });
    const adapter = internals.active.get("telegram");

    await internals.handleInbound(adapter as never, { source: TestChannelSource, text: "observe this" });
    await delay(30);

    expect(events.map((event) => event.kind)).toEqual(["run.started", "run.completed"]);
    expect(events.every((event) => event.context?.scope?.channel === "telegram")).toBe(true);
    await service.stop();
  });

  test("persists session mappings and creates deterministic session ids", async () => {
    const database = openChannelsTestDatabase();
    const store = new AgentChannelSessionMappingStore(database.connection);
    const memory = createMemory();
    const sends: string[] = [];
    const service = new AgentChannelService({
      config: channelsConfig,
      registry: fakeRegistry({ sends }) as never,
      sessionManager: fakeSessionPort(memory),
      mappingStore: store,
      onLog: () => undefined,
    });
    await service.start();
    const internals_ = internals(service);
    const adapter = internals_.active.get("telegram");

    await internals_.handleInbound(adapter as never, { source: TestChannelSource, text: "first" });
    const firstSessionId = memory.submissions[0]?.sessionId as string;
    expect(firstSessionId).toMatch(/^senera_channel_/);
    expect(store.getByLane(TestChannelSource)?.sessionId).toBe(firstSessionId);

    await internals_.handleInbound(adapter as never, { source: TestChannelSource, text: "/new" });
    await internals_.handleInbound(adapter as never, { source: TestChannelSource, text: "second" });
    expect(memory.submissions[1]?.sessionId).not.toBe(firstSessionId);
    expect(store.getByLane(TestChannelSource)?.sessionId).toBe(memory.submissions[1]?.sessionId);
    expect(store.getByLane(TestChannelSource)?.epoch).toBe(2);
    await delay(30);
    expect(sends.some((entry) => entry.includes(`ID: ${memory.submissions[1]?.sessionId}`))).toBe(true);
    await service.stop();
    database.close();
  });

  test("repairs a legacy mapping whose session id was bumped without its epoch", async () => {
    const database = openChannelsTestDatabase();
    const store = new AgentChannelSessionMappingStore(database.connection);
    const legacySessionId = resolveAgentChannelSessionId(TestChannelSource, 2);
    store.upsert(TestChannelSource, legacySessionId, 1, new Date().toISOString());
    const memory = createMemory();
    const sends: string[] = [];
    const service = new AgentChannelService({
      config: channelsConfig,
      registry: fakeRegistry({ sends }) as never,
      sessionManager: fakeSessionPort(memory),
      mappingStore: store,
      onLog: () => undefined,
    });
    await service.start();
    const adapter = internals(service).active.get("telegram");

    await internals(service).handleInbound(adapter as never, { source: TestChannelSource, text: "/new" });
    await internals(service).handleInbound(adapter as never, { source: TestChannelSource, text: "fresh" });

    expect(memory.submissions[0]?.sessionId).toBe(resolveAgentChannelSessionId(TestChannelSource, 3));
    expect(store.getByLane(TestChannelSource)?.epoch).toBe(3);
    await service.stop();
    database.close();
  });

  test("completion port delivers detached run results to the owning lane", async () => {
    const database = openChannelsTestDatabase();
    const store = new AgentChannelSessionMappingStore(database.connection);
    const memory = createMemory();
    const sends: string[] = [];
    const service = new AgentChannelService({
      config: channelsConfig,
      registry: fakeRegistry({ sends }) as never,
      sessionManager: fakeSessionPort(memory),
      mappingStore: store,
      onLog: () => undefined,
    });
    await service.start();
    const internals_ = internals(service);
    const adapter = internals_.active.get("telegram");
    await internals_.handleInbound(adapter as never, { source: TestChannelSource, text: "kick off" });
    const sessionId = memory.submissions[0]?.sessionId as string;

    const port = service.createCompletionPort();
    await port.completed({
      id: "child-1",
      parentSessionId: sessionId,
      task: "备份数据库",
      agentName: "worker",
      status: "completed",
      finalAnswer: "备份完成",
    } as never);

    await delay(50);
    expect(sends.some((entry) => entry.includes("后台任务已完成"))).toBe(true);
    await service.stop();
    database.close();
  });

  test("routes proactive results to the mapped channel lane", async () => {
    const database = openChannelsTestDatabase();
    const store = new AgentChannelSessionMappingStore(database.connection);
    const memory = createMemory();
    const sends: string[] = [];
    const service = new AgentChannelService({
      config: channelsConfig,
      registry: fakeRegistry({ sends }) as never,
      sessionManager: fakeSessionPort(memory),
      mappingStore: store,
      onLog: () => undefined,
    });
    await service.start();
    const internals_ = internals(service);
    const adapter = internals_.active.get("telegram");
    await internals_.handleInbound(adapter as never, { source: TestChannelSource, text: "schedule a reminder" });
    const sessionId = memory.submissions[0]?.sessionId as string;

    await expect(
      service.deliverProactiveResult({
        deliveryId: "scheduled-run-1",
        sessionId,
        content: "提醒你：该上班了。",
        createdAt: new Date().toISOString(),
      }),
    ).resolves.toBe("delivered");
    await delay(30);

    expect(sends.some((entry) => entry.includes("提醒你：该上班了。"))).toBe(true);
    await service.stop();
    database.close();
  });

  test("connectChannel re-creates the adapter from the current configuration", async () => {
    const statuses: AgentChannelStatus[][] = [];
    const memory = createMemory();
    const sends: string[] = [];
    const service = new AgentChannelService({
      config: channelsConfig,
      registry: fakeRegistry({ sends }) as never,
      sessionManager: fakeSessionPort(memory),
      mappingStore: undefined,
      onLog: () => undefined,
      onStatusChanged: (next) => statuses.push(next),
    });
    await service.start();
    const firstAdapter = internals(service).active.get("telegram")?.adapter;

    await service.connectChannel("telegram");

    const secondAdapter = internals(service).active.get("telegram")?.adapter;
    expect(secondAdapter).toBeDefined();
    expect(secondAdapter).not.toBe(firstAdapter);
    expect(statuses.at(-1)?.find((status) => status.kind === "telegram")?.connected).toBe(true);
    await service.stop();
  });

  test("publishes live adapter state and clears stale errors after reconnect", async () => {
    const statuses: AgentChannelStatus[][] = [];
    const memory = createMemory();
    const sends: string[] = [];
    let state: AgentChannelConnectionState = "connecting";
    let handlers: AgentChannelAdapterHandlers | undefined;
    const adapter: AgentChannelAdapter = {
      kind: "telegram",
      capabilities: {
        splitsLongMessages: true,
        maxMessageLength: 4096,
        supportsEdit: false,
        supportsDraft: false,
        markdown: "plain",
        commandPrefix: "/",
      },
      bind: (next) => {
        handlers = next;
      },
      connect: async () => undefined,
      disconnect: async () => undefined,
      getConnectionState: () => state,
      send: async (_source, content) => {
        sends.push(content);
        return { kind: "sent", messageId: `m${sends.length}` };
      },
    };
    const service = new AgentChannelService({
      config: channelsConfig,
      registry: {
        kinds: () => ["telegram" as AgentChannelKind],
        create: () => adapter,
      } as never,
      sessionManager: fakeSessionPort(memory),
      mappingStore: undefined,
      onLog: () => undefined,
      onStatusChanged: (next) => statuses.push(next),
    });

    await service.start();
    expect(statuses.at(-1)?.find((status) => status.kind === "telegram")).toMatchObject({
      connected: false,
      state: "connecting",
    });

    state = "reconnecting";
    handlers?.onConnectionStateChanged?.(state);
    handlers?.onFatal?.(new Error("gateway timed out"), "telegram");
    expect(statuses.at(-1)?.find((status) => status.kind === "telegram")).toMatchObject({
      connected: false,
      state: "reconnecting",
      error: "gateway timed out",
    });

    state = "connected";
    handlers?.onConnectionStateChanged?.(state);
    expect(statuses.at(-1)?.find((status) => status.kind === "telegram")).toMatchObject({
      connected: true,
      state: "connected",
    });
    expect(statuses.at(-1)?.find((status) => status.kind === "telegram")?.error).toBeUndefined();
    await service.stop();
  });

  test("connectChannel no-ops for a disabled channel", async () => {
    const statuses: AgentChannelStatus[][] = [];
    const memory = createMemory();
    const sends: string[] = [];
    const service = new AgentChannelService({
      config: () => resolveAgentChannelsConfig(baseConfig()),
      registry: fakeRegistry({ sends }) as never,
      sessionManager: fakeSessionPort(memory),
      mappingStore: undefined,
      onLog: () => undefined,
      onStatusChanged: (next) => statuses.push(next),
    });
    await service.start();
    const before = internals(service).active.get("telegram");

    await service.connectChannel("qq");

    expect(internals(service).active.get("telegram")).toBe(before);
    expect(internals(service).active.get("qq")).toBeUndefined();
    await service.stop();
  });

  test("syncFromConfig starts and stops adapters when settings change", async () => {
    let current = channelsConfig();
    current = {
      ...current,
      channels: {
        ...current.channels,
        telegram: { ...current.channels.telegram, enabled: false },
      },
    };
    const memory = createMemory();
    const sends: string[] = [];
    const service = new AgentChannelService({
      config: () => current,
      registry: fakeRegistry({ sends }) as never,
      sessionManager: fakeSessionPort(memory),
      mappingStore: undefined,
      onLog: () => undefined,
    });

    await service.start();
    expect(internals(service).active.get("telegram")).toBeUndefined();

    current = channelsConfig();
    await service.syncFromConfig();
    expect(internals(service).active.get("telegram")).toBeDefined();

    current = {
      ...current,
      channels: {
        ...current.channels,
        telegram: { ...current.channels.telegram, enabled: false },
      },
    };
    await service.syncFromConfig();
    expect(internals(service).active.get("telegram")).toBeUndefined();
    await service.stop();
  });
});

describe("channel webhook http api", () => {
  test("fails closed when the channel has no webhook secret", async () => {
    const config = (): AgentChannelsConfig => resolveAgentChannelsConfig(baseConfig());
    const { service, internals } = await runService(config);
    const adapter = internals.active.get("telegram");
    void adapter;
    const api = new AgentChannelWebhookApi({ channels: service });

    const { request, response, outcome } = createHttpPair(
      "/api/channels/telegram/webhook",
      JSON.stringify({ message: {} }),
      { "content-type": "application/json" },
    );
    await api.handle(request, response);
    expect(outcome.status).toBe(500);

    const noListener = createHttpPair("/api/channels/unknown/webhook", "{}", {});
    await api.handle(noListener.request, noListener.response);
    expect(noListener.outcome.status).toBe(404);
    await service.stop();
  });

  test("routes a valid webhook payload to the channel and returns ok", async () => {
    const config = (): AgentChannelsConfig => resolveAgentChannelsConfig(baseConfig({ webhookSecret: "sec" }));
    const memory = createMemory();
    const sends: string[] = [];
    const service = new AgentChannelService({
      config,
      registry: fakeRegistry({ sends }) as never,
      sessionManager: fakeSessionPort(memory),
      mappingStore: undefined,
      onLog: () => undefined,
    });
    await service.start();
    const api = new AgentChannelWebhookApi({ channels: service });

    const { request, response, outcome } = createHttpPair(
      "/api/channels/telegram/webhook",
      JSON.stringify({ message: { chat: { id: 1, type: "private" }, from: { id: 2 }, text: "hello" } }),
      { "content-type": "application/json" },
    );
    await api.handle(request, response);
    expect(outcome.status).toBe(200);
    await service.stop();
  });
});

function createHttpPair(
  url: string,
  rawBody: string,
  headers: Record<string, string>,
): { request: IncomingMessage; response: ServerResponse; outcome: { status: number; body?: string } } {
  const outcome = { status: 0, body: undefined as string | undefined };
  const stream = new EventEmitter();
  const request = {
    url,
    method: "POST",
    headers,
    on: (event: string, listener: (...args: unknown[]) => void) => {
      stream.on(event, listener);
      return request;
    },
    destroy: () => undefined,
  } as unknown as IncomingMessage;
  setImmediate(() => {
    stream.emit("data", Buffer.from(rawBody));
    stream.emit("end");
  });
  const response = {
    writeHead: (status: number) => {
      outcome.status = status;
      return response;
    },
    end: (payload?: string) => {
      outcome.body = payload;
      return response;
    },
  } as unknown as ServerResponse;
  return { request, response, outcome };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
