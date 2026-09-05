import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, test, afterEach } from "vitest";
import {
  AgentChannelService,
  type AgentChannelSessionPort,
  type AgentChannelServiceOptions,
  type AgentChannelStatus,
} from "../../../Source/AgentSystem/Channels/AgentChannelService.js";
import type {
  AgentChannelAdapter,
  AgentChannelConfig,
  AgentChannelInboundMessage,
  AgentChannelKind,
  AgentChannelsConfig,
} from "../../../Source/AgentSystem/Channels/AgentChannelTypes.js";
import { resolveAgentChannelsConfig } from "../../../Source/AgentSystem/Channels/AgentChannelsConfig.js";
import { AgentChannelSessionMappingStore } from "../../../Source/AgentSystem/Channels/AgentChannelSessionMappingStore.js";
import { resolveAgentChannelSessionId } from "../../../Source/AgentSystem/Channels/AgentChannelSessionIdentity.js";
import { AgentChannelWebhookApi } from "../../../Source/AgentSystem/Channels/AgentChannelWebhookApi.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { cleanupChannelsTestRoots, openChannelsTestDatabase, TestChannelSource } from "./AgentChannelTestSupport.js";

afterEach(() => cleanupChannelsTestRoots());

interface FakeSessionMemory {
  readonly submissions: Array<{
    sessionId: string;
    input: string;
    approvalMode: string;
    queueMode?: string;
    requestId?: string;
  }>;
  readonly cancellations: string[];
  readonly steers: Array<{ sessionId: string; input: string }>;
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
    submitMessage: async (request) => {
      memory.submissions.push({
        sessionId: request.sessionId,
        input: request.input,
        approvalMode: request.approvalMode,
        queueMode: request.queueMode,
        requestId: request.requestId,
      });
      if (memory.submissionOutcome !== "accepted") {
        return { kind: memory.submissionOutcome };
      }
      // Replay a terminal run so the renderer completes instead of waiting
      // for the real 10-minute safety timeout.
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
    steerActiveRun: async ({ sessionId, input }) => {
      memory.steers.push({ sessionId, input });
      return memory.activeRuns.has(sessionId);
    },
    hasActiveRun: (sessionId) => memory.activeRuns.has(sessionId),
  };
}

function fakeAdapter(channel: { sends: string[] }): AgentChannelAdapter {
  return {
    kind: "telegram",
    capabilities: {
      splitsLongMessages: true,
      maxMessageLength: 4096,
      supportsEdit: false,
      supportsDraft: false,
      markdown: "plain",
      commandPrefix: "/",
    },
    bind: () => undefined,
    connect: async () => undefined,
    disconnect: async () => undefined,
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

function fakeRegistry(channel: { sends: string[] }) {
  let created = 0;
  return {
    kinds: () => ["telegram" as AgentChannelKind],
    create: () => {
      created += 1;
      void created;
      return fakeAdapter(channel);
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

function channelsConfig(overrides?: Parameters<typeof baseConfig>[0]): AgentChannelsConfig {
  return resolveAgentChannelsConfig(baseConfig(overrides));
}

interface ServiceInternals {
  handleInbound(channel: never, message: AgentChannelInboundMessage): Promise<void>;
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

describe("channel service", () => {
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

    await internals.handleInbound(adapter as never, { source: TestChannelSource, text: "现在能处理吗" });

    expect(memory.submissions).toHaveLength(1);
    await delay(30);
    expect(sends.some((entry) => entry.includes("请稍后重新发送"))).toBe(true);
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
      { sessionId: resolveAgentChannelSessionId(TestChannelSource, 1), input: "先别做这个" },
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
