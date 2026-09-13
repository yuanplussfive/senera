import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  executeSeneraSelfCommandViaHttp,
  selfServiceUrl,
  SeneraSelfServiceOfflineError,
} from "../../../Apps/SeneraCliHttpClient.js";
import {
  AgentRuntimeManifestStore,
  resolveAgentRuntimeManifestPath,
} from "../../../Source/AgentSystem/Runtime/AgentRuntimeManifest.js";
import type { AgentConfigSnapshot } from "../../../Source/AgentSystem/Config/AgentConfigService.js";
import { AgentSelfHttpApi } from "../../../Source/AgentSystem/SelfService/AgentSelfHttpApi.js";
import type { AgentSelfServicePort } from "../../../Source/AgentSystem/SelfService/AgentSelfServiceTypes.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

const temporaryWorkspaces: string[] = [];
const servers: http.Server[] = [];

describe("senera self-service closed loop over HTTP", () => {
  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
            server.closeAllConnections?.();
          }),
      ),
    );
    for (const root of temporaryWorkspaces.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  test("config read round-trips through manifest discovery, token auth and the executor", async () => {
    const workspaceRoot = createTemporaryWorkspace();
    const { port: stub } = createStubSelfServicePort(workspaceRoot);
    const { api, port } = await startSelfServiceServer(stub);
    const { token } = new AgentRuntimeManifestStore(workspaceRoot).start({ host: "127.0.0.1", port });
    api.bindToken(token);

    const output = await executeSeneraSelfCommandViaHttp(workspaceRoot, {
      command: "config",
      action: "get",
      path: "Server.Port",
    });

    expect(output.ok).toBe(true);
    expect(output.data).toBe(8787);
    expect(output.text).toBe("8787");
  });

  test("config update commits through the live host port and returns the revision", async () => {
    const workspaceRoot = createTemporaryWorkspace();
    const { port: stub, calls } = createStubSelfServicePort(workspaceRoot);
    const { api, port } = await startSelfServiceServer(stub);
    const { token } = new AgentRuntimeManifestStore(workspaceRoot).start({ host: "127.0.0.1", port });
    api.bindToken(token);

    const output = await executeSeneraSelfCommandViaHttp(workspaceRoot, {
      command: "config",
      action: "update",
      path: "Server.HotReload",
      value: false,
    });

    expect(output.ok).toBe(true);
    expect(calls.replaces).toBe(1);
    expect(output.data).toMatchObject({ path: "Server.HotReload", revision: 8 });
  });

  test("fails deterministically when no runtime manifest exists", async () => {
    const workspaceRoot = createTemporaryWorkspace();

    await expect(
      executeSeneraSelfCommandViaHttp(workspaceRoot, { command: "doctor", action: "status" }),
    ).rejects.toBeInstanceOf(SeneraSelfServiceOfflineError);
  });

  test("fails deterministically when the recorded process is dead", async () => {
    const workspaceRoot = createTemporaryWorkspace();
    fs.mkdirSync(path.dirname(resolveAgentRuntimeManifestPath(workspaceRoot)), { recursive: true });
    fs.writeFileSync(
      resolveAgentRuntimeManifestPath(workspaceRoot),
      JSON.stringify({
        pid: 99_999_999,
        startedAt: new Date().toISOString(),
        host: "127.0.0.1",
        port: 1,
        token: "stale",
        protocol: 1,
      }),
      "utf8",
    );

    await expect(
      executeSeneraSelfCommandViaHttp(workspaceRoot, { command: "config", action: "models" }),
    ).rejects.toBeInstanceOf(SeneraSelfServiceOfflineError);
  });

  test("rejects commands signed with a stale token", async () => {
    const workspaceRoot = createTemporaryWorkspace();
    const { port: stub } = createStubSelfServicePort(workspaceRoot);
    const { api, port } = await startSelfServiceServer(stub);
    new AgentRuntimeManifestStore(workspaceRoot).start({ host: "127.0.0.1", port });
    api.bindToken("live-token");
    fs.writeFileSync(
      resolveAgentRuntimeManifestPath(workspaceRoot),
      fs.readFileSync(resolveAgentRuntimeManifestPath(workspaceRoot), "utf8").replace('"live-token"', '"stale-token"'),
      "utf8",
    );

    await expect(
      executeSeneraSelfCommandViaHttp(workspaceRoot, { command: "config", action: "models" }),
    ).rejects.toThrow(/HTTP 401/);
  });

  test("rejects malformed command payloads with a structured 400", async () => {
    const workspaceRoot = createTemporaryWorkspace();
    const { port: stub } = createStubSelfServicePort(workspaceRoot);
    const { api, port } = await startSelfServiceServer(stub);
    const { token } = new AgentRuntimeManifestStore(workspaceRoot).start({ host: "127.0.0.1", port });
    api.bindToken(token);

    const response = await fetch(`http://127.0.0.1:${port}/senera/self`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ command: "config", action: "explode", args: "not-an-array" }),
    });

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error?: { code?: string } };
    expect(payload.error?.code).toBe("invalid_command");
  });

  test("only projects runtime manifests to loopback service URLs", () => {
    expect(selfServiceUrl("0.0.0.0", 8787)).toBe("http://127.0.0.1:8787/senera/self");
    expect(selfServiceUrl("[::1]", 8787)).toBe("http://[::1]:8787/senera/self");
    expect(() => selfServiceUrl("example.com", 8787)).toThrow(/loopback/u);
    expect(() => selfServiceUrl("127.0.0.1", 0)).toThrow(/invalid service port/u);
  });
});

function createTemporaryWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-self-"));
  temporaryWorkspaces.push(root);
  return root;
}

function createStubSelfServicePort(workspaceRoot: string): {
  port: AgentSelfServicePort;
  calls: { replaces: number };
} {
  const config = { Server: { Host: "127.0.0.1", Port: 8787, HotReload: true } } as unknown as AgentSystemConfig;
  const snapshot: AgentConfigSnapshot = {
    path: "stub",
    version: 0,
    value: config,
    source: "json",
    revision: 7,
    diagnostics: [],
    form: { version: 1, sections: [] },
  };
  const calls = { replaces: 0 };
  const port: AgentSelfServicePort = {
    workspaceRoot,
    config: {
      getSnapshot: () => snapshot,
      replace: (input) => {
        calls.replaces += 1;
        return { ...snapshot, value: input.config, revision: 8 };
      },
      history: () => [],
      readRevision: () => ({ status: "unavailable" }),
    },
    presets: {
      manager: () => {
        throw new Error("preset manager is not exercised by this test");
      },
    },
  };
  return { port, calls };
}

function startSelfServiceServer(port: AgentSelfServicePort): Promise<{ api: AgentSelfHttpApi; port: number }> {
  return new Promise((resolve) => {
    const api = new AgentSelfHttpApi(port);
    const server = http.createServer((request, response) => {
      void api.handle(request, response);
    });
    servers.push(server);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      resolve({ api, port: address.port });
    });
  });
}
