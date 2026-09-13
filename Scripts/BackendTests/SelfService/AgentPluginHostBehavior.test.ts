import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { AgentPluginHost } from "../../../Source/AgentSystem/Plugins/AgentPluginHost.js";
import type { AgentPluginEntryModule } from "../../../Source/AgentSystem/Plugins/AgentPluginHost.js";
import {
  AgentPluginManifestFileName,
  AgentPluginManifestSchema,
  type AgentPluginManifest,
} from "../../../Source/AgentSystem/Plugins/AgentPluginTypes.js";
import type { AgentPluginDiscoverySource } from "../../../Source/AgentSystem/Plugins/AgentPluginDiscovery.js";
import type { AgentPluginRegistrationContext } from "../../../Source/AgentSystem/Plugins/AgentPluginContext.js";
import {
  findAgentSelfPluginCommand,
  listAgentSelfPluginCommands,
  registerAgentSelfCommand,
} from "../../../Source/AgentSystem/SelfService/AgentSelfCommandRegistry.js";
import {
  AgentApprovalTransportRegistry,
  createHttpApprovalTransport,
} from "../../../Source/AgentSystem/SelfService/AgentApprovalTransport.js";
import { AgentSelfApprovalRegistry } from "../../../Source/AgentSystem/SelfService/AgentSelfApprovalRegistry.js";
import { executeAgentSelfCommand } from "../../../Source/AgentSystem/SelfService/AgentSelfCommand.js";
import type {
  AgentSelfCommandOutput,
  AgentSelfServicePort,
} from "../../../Source/AgentSystem/SelfService/AgentSelfServiceTypes.js";
import { AgentSelfHttpApi } from "../../../Source/AgentSystem/SelfService/AgentSelfHttpApi.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import type { RegisteredSkill } from "../../../Source/AgentSystem/Skills/AgentSkillTypes.js";

const temporaryRoots: string[] = [];
const servers: http.Server[] = [];

describe("senera plugin host", () => {
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
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  test("discovers manifests across bundled, user, project and pip sources", () => {
    const root = createTemporaryRoot();
    writePlugin(root, "bundle-a", { id: "bundle-a", source: "bundled" });
    writePlugin(root, "user-b", { id: "user-b", source: "user" });
    writePlugin(root, "project-c", { id: "project-c", source: "project" });
    writePlugin(root, "pip-d", { id: "pip-d", source: "pip" });

    const host = new AgentPluginHost({ sources: sourcesFor(root) });
    host.discover();

    const entries = host.list();
    expect(entries.map((entry) => [entry.id, entry.source, entry.builtin])).toEqual([
      ["bundle-a", "bundled", true],
      ["user-b", "user", false],
      ["project-c", "project", false],
      ["pip-d", "pip", false],
    ]);
  });

  test("reports invalid manifests and duplicate ids without aborting discovery", () => {
    const root = createTemporaryRoot();
    fs.mkdirSync(path.join(root, "user-dir", "broken"), { recursive: true });
    fs.writeFileSync(path.join(root, "user-dir", "broken", AgentPluginManifestFileName), "{ not json", "utf8");
    writePlugin(root, "dup", { id: "same-id", source: "user" });
    writePlugin(root, "dup-two", { id: "same-id", source: "user" });

    const host = new AgentPluginHost({ sources: sourcesFor(root) });
    host.discover();

    expect(host.list()).toHaveLength(1);
    const errors = host.discoveryErrors();
    expect(errors.some((error) => error.message.includes("Invalid plugin manifest JSON"))).toBe(true);
    expect(errors.some((error) => error.message.includes("Duplicate plugin id"))).toBe(true);
  });

  test("bundled plugins load by default; user plugins need the opt-in whitelist", async () => {
    const root = createTemporaryRoot();
    writePlugin(root, "bundled-a", { id: "bundled-a", source: "bundled" });
    writePlugin(root, "user-b", { id: "user-b", source: "user" });
    const loader = loaderByManifest();

    const host = new AgentPluginHost({
      sources: sourcesFor(root),
      enabled: ["user-b"],
      loadEntry: loader.load,
    });
    host.discover();
    await host.load();

    const byId = new Map(host.list().map((entry) => [entry.id, entry]));
    expect(byId.get("bundled-a")?.enabled).toBe(true);
    expect(byId.get("bundled-a")?.loaded).toBe(true);
    expect(byId.get("user-b")?.enabled).toBe(true);
    expect(byId.get("user-b")?.loaded).toBe(true);
    expect(host.loadedPluginCount()).toBe(2);
  });

  test("whitelisted user plugins stay unloaded without an entry module", async () => {
    const root = createTemporaryRoot();
    writePlugin(root, "user-b", { id: "user-b", source: "user" });

    const host = new AgentPluginHost({
      sources: sourcesFor(root),
      enabled: ["user-b"],
      loadEntry: async () => {
        throw new Error("module not found");
      },
    });
    host.discover();
    await host.load();

    const entry = host.list().find((item) => item.id === "user-b");
    expect(entry?.loaded).toBe(false);
    expect(entry?.error).toMatch(/无法加载插件入口/);
  });

  test("loads dependencies before dependents and records the visit order", async () => {
    const root = createTemporaryRoot();
    writePlugin(root, "base", { id: "base", source: "bundled" });
    writePlugin(root, "ext", { id: "ext", source: "user", requires: ["base"] });
    const order: string[] = [];
    const loader = loaderByManifest((id) => {
      order.push(id);
    });

    const host = new AgentPluginHost({
      sources: sourcesFor(root),
      enabled: ["ext"],
      loadEntry: loader.load,
    });
    host.discover();
    await host.load();

    expect(order).toEqual(["base", "ext"]);
    expect(host.list().every((entry) => entry.loaded)).toBe(true);
  });

  test("records missing and unenabled dependencies without loading the dependent", async () => {
    const root = createTemporaryRoot();
    writePlugin(root, "ext", { id: "ext", source: "user", requires: ["ghost"] });
    writePlugin(root, "other", { id: "other", source: "user" });
    const loaded: string[] = [];
    const loader = loaderByManifest((id) => {
      loaded.push(id);
    });

    const host = new AgentPluginHost({
      sources: sourcesFor(root),
      enabled: ["ext", "other"],
      loadEntry: loader.load,
    });
    host.discover();
    await host.load();

    expect(loaded).toEqual(["other"]);
    const ext = host.list().find((entry) => entry.id === "ext");
    expect(ext?.loaded).toBe(false);
    expect(ext?.error).toMatch(/依赖的插件不存在/);
  });

  test("detects dependency cycles deterministically", async () => {
    const root = createTemporaryRoot();
    writePlugin(root, "a", { id: "a", source: "user", requires: ["b"] });
    writePlugin(root, "b", { id: "b", source: "user", requires: ["a"] });

    const host = new AgentPluginHost({
      sources: sourcesFor(root),
      enabled: ["a", "b"],
      loadEntry: async () => ({ register() {} }),
    });
    host.discover();
    await host.load();

    const a = host.list().find((entry) => entry.id === "a");
    expect(a?.loaded).toBe(false);
    expect(a?.error).toMatch(/插件依赖循环/);
    expect(host.loadedPluginCount()).toBe(0);
  });

  test("isolates register failures: one broken plugin never blocks the others", async () => {
    const root = createTemporaryRoot();
    writePlugin(root, "broken", { id: "broken", source: "user" });
    writePlugin(root, "fine", { id: "fine", source: "user" });
    const loader = loaderByManifest((id) => {
      if (id === "broken") throw new Error("broken entry crashed");
    });

    const host = new AgentPluginHost({
      sources: sourcesFor(root),
      enabled: ["broken", "fine"],
      loadEntry: loader.load,
    });
    host.discover();
    await expect(host.load()).resolves.toBeUndefined();

    expect(host.list().find((entry) => entry.id === "broken")?.error).toMatch(/register\(ctx\) 失败/);
    expect(host.list().find((entry) => entry.id === "fine")?.loaded).toBe(true);
    expect(host.loadedPluginCount()).toBe(1);
  });

  test("rejects entry paths escaping the plugin directory", async () => {
    const root = createTemporaryRoot();
    writePlugin(root, "evil", { id: "evil", source: "user", entry: "../escape.js" });

    const host = new AgentPluginHost({ sources: sourcesFor(root), enabled: ["evil"] });
    host.discover();
    await host.load();

    const entry = host.list().find((item) => item.id === "evil");
    expect(entry?.loaded).toBe(false);
    expect(entry?.error).toMatch(/非法插件入口路径/);
  });

  test("requires discover() before load() and list()", async () => {
    const host = new AgentPluginHost({ sources: [] });
    expect(() => host.list()).toThrow(/discover\(\)/);
    await expect(host.load()).rejects.toThrow(/discover\(\)/);
  });

  test("applies registered tools and skills to a runtime extension registry", async () => {
    const root = createTemporaryRoot();
    writePlugin(root, "tooler", { id: "tooler", source: "bundled" });
    const loader = loaderByManifest((_id, context) => {
      context.registerTool([pluginToolFixture("WeatherTool")]);
      context.registerSkill([pluginSkillFixture("weather-skill")]);
    });

    const host = new AgentPluginHost({ sources: sourcesFor(root), loadEntry: loader.load });
    host.discover();
    await host.load();

    const registry = new AgentExtensionRegistry();
    host.applyTools(registry);

    const tool = registry.getTool("WeatherTool");
    expect(tool?.owner.kind).toBe("plugin");
    expect(tool?.owner.name).toBe("tooler");
    expect(registry.getSkill("weather-skill")?.name).toBe("weather-skill");
  });

  test("registers approval transports through the plugin context", async () => {
    const root = createTemporaryRoot();
    writePlugin(root, "notifier", { id: "notifier", source: "bundled" });
    const transports = new AgentApprovalTransportRegistry();
    const loader = loaderByManifest((_id, context) => {
      context.registerApprovalTransport({
        name: "custom-push",
        kind: "custom",
        async request() {
          return { status: "approved" };
        },
      });
    });

    const host = new AgentPluginHost({
      sources: sourcesFor(root),
      approvalTransports: transports,
      loadEntry: loader.load,
    });
    host.discover();
    await host.load();

    expect(transports.get("custom-push")?.kind).toBe("custom");
    expect(transports.preferred()?.name).toBe("custom-push");
  });

  test("rejects transport registration when the host has no transport registry", async () => {
    const root = createTemporaryRoot();
    writePlugin(root, "solo", { id: "solo", source: "bundled" });
    const loader = loaderByManifest((_id, context) => {
      context.registerApprovalTransport({
        name: "orphan",
        kind: "custom",
        async request() {
          return { status: "denied", message: "unused" };
        },
      });
    });

    const host = new AgentPluginHost({ sources: sourcesFor(root), loadEntry: loader.load });
    host.discover();
    await host.load();

    expect(host.list().find((entry) => entry.id === "solo")?.error).toMatch(/未提供审批传输注册表/);
  });

  test("runs onStart and onShutdown hooks in registration order", async () => {
    const root = createTemporaryRoot();
    writePlugin(root, "hooker", { id: "hooker", source: "bundled" });
    const events: string[] = [];
    const loader = loaderByManifest((_id, context) => {
      context.registerHook({ name: "onStart", handler: () => void events.push("start-1") });
      context.registerHook({ name: "onStart", handler: () => void events.push("start-2") });
      context.registerHook({ name: "onShutdown", handler: () => void events.push("shutdown") });
    });

    const host = new AgentPluginHost({ sources: sourcesFor(root), loadEntry: loader.load });
    host.discover();
    await host.load();
    await host.start();
    expect(host.isStarted()).toBe(true);
    await host.shutdown();

    expect(events).toEqual(["start-1", "start-2", "shutdown"]);
  });

  test("rejects unknown hook names", async () => {
    const root = createTemporaryRoot();
    writePlugin(root, "hooker", { id: "hooker", source: "bundled" });
    const loader = loaderByManifest((_id, context) => {
      context.registerHook({ name: "onBoom", handler: () => undefined } as never);
    });

    const host = new AgentPluginHost({ sources: sourcesFor(root), loadEntry: loader.load });
    host.discover();
    await host.load();

    expect(host.list().find((entry) => entry.id === "hooker")?.error).toMatch(/Unknown plugin hook name/);
  });

  test("plugin commands resolve through the registry and reject duplicate keys", async () => {
    const root = createTemporaryRoot();
    writePlugin(root, "weather", { id: "weather", source: "bundled" });
    const loader = loaderByManifest((_id, context) => {
      context.registerCommand(
        { command: "weather", action: "current", usage: "senera weather current", description: "当前天气", args: [] },
        async (args) => ({ ok: true, text: `sunny ${args.join(" ")}`, data: { condition: "sunny" } }),
      );
    });

    const host = new AgentPluginHost({ sources: sourcesFor(root), loadEntry: loader.load });
    host.discover();
    await host.load();

    const entry = findAgentSelfPluginCommand("weather", "current");
    expect(entry?.spec.usage).toBe("senera weather current");
    expect((await entry?.handler(["shanghai"], stubPort(root), {}))?.text).toBe("sunny shanghai");

    expect(() =>
      registerAgentSelfCommand(
        { command: "weather", action: "current", usage: "x", description: "y", args: [] },
        async () => ({ ok: true, text: "duplicate" }),
      ),
    ).toThrow(/already registered/);
    expect(listAgentSelfPluginCommands().some((item) => item.spec.command === "weather")).toBe(true);
    await host.shutdown();
  });

  test("plugins list command renders discovered plugins through the port", async () => {
    const root = createTemporaryRoot();
    writePlugin(root, "shown", { id: "shown", source: "bundled" });
    const host = new AgentPluginHost({ sources: sourcesFor(root), loadEntry: async () => ({ register() {} }) });
    host.discover();
    await host.load();

    const output = await executeAgentSelfCommand(
      { command: "plugins", action: "list" },
      { ...stubPort(root), plugins: portPluginsFor(host) },
    );
    expect(output.ok).toBe(true);
    expect(output.text).toContain("shown@1.0.0");
    expect((output.data as { plugins: readonly { id: string }[] }).plugins[0]?.id).toBe("shown");
  });

  test("plugins list fails deterministically when the host binds no plugin port", async () => {
    const output = await executeAgentSelfCommand(
      { command: "plugins", action: "list" },
      stubPort(createTemporaryRoot()),
    );
    expect(output.ok).toBe(false);
    expect(output.error).toBe("plugins_unavailable");
  });

  test("http api dispatches plugin command envelopes and rejects unknown commands deterministically", async () => {
    const root = createTemporaryRoot();
    writePlugin(root, "weather", { id: "weather", source: "bundled" });
    const loader = loaderByManifest((_id, context) => {
      context.registerCommand(
        { command: "weather", action: "current", usage: "senera weather current", description: "当前天气", args: [] },
        async (args) => ({ ok: true, text: `sunny ${args.join(" ")}`, data: { condition: "sunny" } }),
      );
    });
    const host = new AgentPluginHost({ sources: sourcesFor(root), loadEntry: loader.load });
    host.discover();
    await host.load();

    const { api, port } = await startPluginHttpServer({ ...stubPort(root), plugins: portPluginsFor(host) });
    api.bindToken("live-token");

    const handled = await postPluginEnvelope(port, { command: "weather", action: "current", args: ["shanghai"] });
    expect(handled.ok).toBe(true);
    expect(handled.text).toBe("sunny shanghai");

    const unknown = await postPluginEnvelope(port, { command: "ghost", action: "run" });
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toBe("unknown_command");
    expect(unknown.text).toContain("既非内置命令");
  });

  test("http approval transport defers to the one-shot approval ledger", async () => {
    const registry = new AgentSelfApprovalRegistry();
    const transport = createHttpApprovalTransport(registry);
    const command = { command: "config", action: "rollback", revision: 3 } as const;

    const verdict = await transport.request({
      command,
      path: "Server.AccessControl.Mode",
      value: "required",
      rule: { pattern: "Server.AccessControl.*", level: "human", reason: "访问控制配置" },
    });
    expect(verdict.status).toBe("deferred");
    if (verdict.status !== "deferred") throw new Error("unreachable");

    if (!transport.resolve) throw new Error("HTTP approval transport must support resolve()");
    const resolved = await transport.resolve(verdict.approvalId, "approve");
    expect(resolved).toMatchObject({ status: "resolved", decision: "approve", command });
    expect(await transport.resolve("missing-id", "approve")).toEqual({ status: "unknown" });
  });

  test("approval expires at its deadline", () => {
    let now = 10_000;
    const registry = new AgentSelfApprovalRegistry(() => now);
    const command = { command: "status" } as const;
    const pending = registry.create(command);

    now += 5 * 60 * 1_000;

    expect(registry.resolve(pending.approvalId, "approve")).toEqual({ status: "unknown" });
  });
});

function createTemporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-plugin-"));
  temporaryRoots.push(root);
  return root;
}

interface PluginFixtureOptions {
  readonly id: string;
  readonly source: "bundled" | "user" | "project" | "pip";
  readonly requires?: readonly string[];
  readonly entry?: string;
}

function writePlugin(root: string, folder: string, options: PluginFixtureOptions): void {
  const directory = path.join(root, `${options.source}-dir`, folder);
  fs.mkdirSync(directory, { recursive: true });
  const manifest: AgentPluginManifest = AgentPluginManifestSchema.parse({
    id: options.id,
    name: options.id,
    version: "1.0.0",
    kind: "general",
    description: `test plugin ${options.id}`,
    entry: options.entry ?? "entry.js",
    ...(options.requires ? { requires: options.requires } : {}),
  });
  fs.writeFileSync(path.join(directory, AgentPluginManifestFileName), JSON.stringify(manifest), "utf8");
}

function sourcesFor(root: string): AgentPluginDiscoverySource[] {
  return (["bundled", "user", "project", "pip"] as const).map((source) => ({
    source,
    directory: path.join(root, `${source}-dir`),
  }));
}

/** Injected entry loader; registration no-ops unless overridden. */
function loaderByManifest(register?: (id: string, context: AgentPluginRegistrationContext) => void | Promise<void>): {
  load(directory: string, entry: string): Promise<AgentPluginEntryModule>;
} {
  return {
    async load(directory: string): Promise<AgentPluginEntryModule> {
      const manifest = AgentPluginManifestSchema.parse(
        JSON.parse(fs.readFileSync(path.join(directory, AgentPluginManifestFileName), "utf8")),
      );
      return {
        async register(context: AgentPluginRegistrationContext) {
          if (register) await register(manifest.id, context);
        },
      };
    },
  };
}

function stubPort(workspaceRoot: string): AgentSelfServicePort {
  return {
    workspaceRoot,
    config: {
      getSnapshot: () => ({
        path: "stub",
        version: 0,
        value: { ModelProviders: [] },
        source: "json",
        revision: 7,
        diagnostics: [],
        form: { version: 1, sections: [] },
      }),
      replace: () => ({
        path: "stub",
        version: 0,
        value: { ModelProviders: [] },
        source: "json",
        revision: 8,
        diagnostics: [],
        form: { version: 1, sections: [] },
      }),
      history: () => [],
      readRevision: () => ({ status: "unavailable" }),
    },
    presets: {
      manager: () => {
        throw new Error("preset manager is not exercised by this test");
      },
    },
  };
}

function portPluginsFor(host: AgentPluginHost): NonNullable<AgentSelfServicePort["plugins"]> {
  return {
    list: () => host.list(),
    discoveryErrors: () => host.discoveryErrors(),
  };
}

function pluginToolFixture(name: string): RegisteredTool {
  return {
    name,
    loading: "eager",
    permissions: [],
    handler: { kind: "HostCapability", capability: name },
    execution: { Workspace: "ReadOnly" },
    runtime: {},
    sources: [],
    childGrant: "inherit",
    evidenceCapabilities: [],
  } as unknown as RegisteredTool;
}

function pluginSkillFixture(name: string): RegisteredSkill {
  return {
    source: { kind: "standalone", id: "ignored", displayName: "ignored" },
    name,
    description: `test skill ${name}`,
    descriptionFile: `${name}.md`,
    recommendedTools: [],
    evidenceRequirements: [],
  };
}

function startPluginHttpServer(port: AgentSelfServicePort): Promise<{ api: AgentSelfHttpApi; port: number }> {
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

async function postPluginEnvelope(port: number, payload: unknown): Promise<AgentSelfCommandOutput> {
  const response = await fetch(`http://127.0.0.1:${port}/senera/self`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer live-token" },
    body: JSON.stringify(payload),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as AgentSelfCommandOutput;
}
