import { describe, expect, test, vi } from "vitest";
import {
  AgentMcpToolClientPool,
  AgentMcpToolClientUnavailableError,
  createAgentMcpToolClientPoolKey,
} from "../../../Source/AgentSystem/Mcp/AgentMcpToolClientPool.js";
import type {
  AgentMcpToolClient,
  AgentMcpToolClientOptions,
} from "../../../Source/AgentSystem/Mcp/AgentMcpToolClient.js";
import { AgentMcpTaskDetachedError } from "../../../Source/AgentSystem/Mcp/AgentMcpToolClient.js";
import { AgentInteractionInputRuntime } from "../../../Source/AgentSystem/Interaction/AgentInteractionInputRuntime.js";

describe("MCP tool client pool", () => {
  test("replaces one stale client without recursive acquisition", async () => {
    const stale = fakeClient(true);
    const live = fakeClient(false);
    const open = vi.fn(async () => (open.mock.calls.length === 1 ? stale.client : live.client));
    const pool = new AgentMcpToolClientPool(open);

    await expect(pool.withClient(connection(), async (client) => client === live.client)).resolves.toBe(true);
    expect(open).toHaveBeenCalledTimes(2);
    await pool.close();
  });

  test("fails after the bounded stale-client replacement", async () => {
    const open = vi.fn(async () => fakeClient(true).client);
    const pool = new AgentMcpToolClientPool(open);

    await expect(pool.withClient(connection(), async () => "unreachable")).rejects.toMatchObject({
      name: AgentMcpToolClientUnavailableError.name,
      serverId: "pool-fixture",
      replacements: 1,
    });
    expect(open).toHaveBeenCalledTimes(2);
    await pool.close();
  });

  test("shares one opening client across concurrent operations", async () => {
    const live = fakeClient(false);
    const open = vi.fn(async () => live.client);
    const pool = new AgentMcpToolClientPool(open);
    const sharedConnection = connection();

    const values = await Promise.all([
      pool.withClient(sharedConnection, async () => "left"),
      pool.withClient(sharedConnection, async () => "right"),
    ]);

    expect(values).toEqual(["left", "right"]);
    expect(open).toHaveBeenCalledOnce();
    await Promise.all([pool.close(), pool.close()]);
    expect(live.close).toHaveBeenCalledOnce();
  });

  test("keeps a failed close entry for an explicit retry", async () => {
    const client = fakeClient(false);
    client.close.mockRejectedValueOnce(new Error("transport did not terminate")).mockResolvedValueOnce(undefined);
    const pool = new AgentMcpToolClientPool(vi.fn(async () => client.client));

    await pool.withClient(connection(), async () => "ready");
    await expect(pool.close()).rejects.toThrow("transport did not terminate");
    await expect(pool.close()).resolves.toBeUndefined();
    expect(client.close).toHaveBeenCalledTimes(2);
  });

  test("reattaches a detached task on one replacement client without repeating the operation", async () => {
    const first = fakeClient(false);
    const second = fakeClient(false);
    const recovered = { content: [{ type: "text", text: "recovered" }] };
    const reattachTask = vi.fn(async () => recovered);
    Object.assign(second.client, { reattachTask });
    const open = vi.fn(async () => (open.mock.calls.length === 1 ? first.client : second.client));
    const pool = new AgentMcpToolClientPool(open);
    const operation = vi.fn(async (client: AgentMcpToolClient) => {
      Object.assign(client, { closed: true });
      throw new AgentMcpTaskDetachedError("remote", "task-recover");
    });
    const onDetached = vi.fn();

    await expect(pool.withRecoverableTask(connection(), operation, {}, onDetached)).resolves.toEqual(recovered);
    expect(operation).toHaveBeenCalledOnce();
    expect(reattachTask).toHaveBeenCalledWith("task-recover", {});
    expect(onDetached).toHaveBeenCalledWith(expect.objectContaining({ taskId: "task-recover" }));
    expect(open).toHaveBeenCalledTimes(2);
    await pool.close();
  });

  test("includes termination policy in the pool identity", () => {
    const base = connection();
    expect(createAgentMcpToolClientPoolKey(base)).not.toBe(
      createAgentMcpToolClientPoolKey({ ...base, terminationGraceMs: base.terminationGraceMs + 1 }),
    );
  });

  test.each([
    ["request timeout", (base: ReturnType<typeof connection>) => ({ ...base, requestTimeoutMs: 2_000 })],
    ["frame limit", (base: ReturnType<typeof connection>) => ({ ...base, maxFrameBytes: 2_048 })],
    ["stderr limit", (base: ReturnType<typeof connection>) => ({ ...base, maxStderrBytes: 4_096 })],
    [
      "host cwd root",
      (base: ReturnType<typeof connection>) => ({
        ...base,
        executionProfile: { ...base.executionProfile, hostCwdRoot: "C:/trusted-tools" },
      }),
    ],
  ])("includes %s in the pool identity", (_label, mutate) => {
    const base = connection();
    expect(createAgentMcpToolClientPoolKey(base)).not.toBe(createAgentMcpToolClientPoolKey(mutate(base)));
  });

  test("keeps pool identity stable across equivalent object key order", () => {
    const base = connection();
    const reorderedServer = Object.fromEntries(Object.entries(base.server).reverse()) as typeof base.server;

    expect(createAgentMcpToolClientPoolKey(base)).toBe(
      createAgentMcpToolClientPoolKey({ ...base, server: reorderedServer }),
    );
  });

  test("separates elicitation-capable clients from ordinary pooled clients", () => {
    const base = connection();
    expect(createAgentMcpToolClientPoolKey(base)).not.toBe(
      createAgentMcpToolClientPoolKey({ ...base, interactionInput: new AgentInteractionInputRuntime() }),
    );
  });

  test("separates catalog-watching clients from clients without list-change handling", () => {
    const base = connection();
    expect(createAgentMcpToolClientPoolKey(base)).not.toBe(
      createAgentMcpToolClientPoolKey({ ...base, onToolsChanged: async () => undefined }),
    );
  });

  test("separates clients with different injected behavior instances", () => {
    const base = connection();
    const firstHandler = async () => undefined;
    const secondHandler = async () => undefined;
    expect(createAgentMcpToolClientPoolKey(base)).not.toBe(
      createAgentMcpToolClientPoolKey({
        ...base,
        spawnPersistentProcess: async () => {
          throw new Error("different spawner");
        },
      }),
    );
    expect(createAgentMcpToolClientPoolKey({ ...base, onToolsChanged: firstHandler })).not.toBe(
      createAgentMcpToolClientPoolKey({ ...base, onToolsChanged: secondHandler }),
    );
  });
});

function connection(): Omit<AgentMcpToolClientOptions, "signal"> {
  return {
    server: {
      id: "pool-fixture",
      revision: "test",
      command: "node",
      args: ["server.js"],
      cwd: "C:/workspace",
    },
    requestTimeoutMs: 1_000,
    terminationGraceMs: 10,
    executionProfile: {
      name: "pool-fixture",
      kind: "mcp-server",
      backend: "local",
    },
    spawnPersistentProcess: async () => {
      throw new Error("unused");
    },
  };
}

function fakeClient(closed: boolean): { client: AgentMcpToolClient; close: ReturnType<typeof vi.fn> } {
  const close = vi.fn(async () => undefined);
  return {
    client: {
      closed,
      close,
    } as unknown as AgentMcpToolClient,
    close,
  };
}
