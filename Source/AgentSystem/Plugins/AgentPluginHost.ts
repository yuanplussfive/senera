import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import { registerAgentSelfCommand } from "../SelfService/AgentSelfCommandRegistry.js";
import type { AgentExtensionOwner } from "../Types/AgentExtensionRuntimeTypes.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import type { RegisteredSkill } from "../Skills/AgentSkillTypes.js";
import type { AgentApprovalTransport, AgentApprovalTransportRegistry } from "../SelfService/AgentApprovalTransport.js";
import {
  discoverAgentPlugins,
  type AgentPluginDiscoveryError,
  type AgentPluginDiscoverySource,
} from "./AgentPluginDiscovery.js";
import { AgentPluginHookRegistry, type AgentPluginRegistrationContext } from "./AgentPluginContext.js";
import {
  type AgentPluginDescriptor,
  type AgentPluginListEntry,
  type AgentPluginLoadError,
} from "./AgentPluginTypes.js";

/** Loads a plugin entry module; the real host uses dynamic `import()`, tests
 * inject a fixture loader. */
export type AgentPluginEntryLoader = (directory: string, entry: string) => Promise<AgentPluginEntryModule>;

/** A loaded plugin entry module. `register` receives the host registration
 * context; sync and async registrations are both supported. */
export interface AgentPluginEntryModule {
  readonly register: (context: AgentPluginRegistrationContext) => void | Promise<void>;
}

export interface AgentPluginHostOptions {
  readonly sources: readonly AgentPluginDiscoverySource[];
  /** Opt-in whitelist from `Plugins.Enabled`; bundled plugins load by default. */
  readonly enabled?: readonly string[];
  readonly approvalTransports?: AgentApprovalTransportRegistry;
  readonly loadEntry?: AgentPluginEntryLoader;
}

interface LoadedAgentPlugin {
  readonly plugin: AgentPluginDescriptor;
  readonly tools: readonly RegisteredTool[];
  readonly skills: readonly RegisteredSkill[];
  readonly cleanup: readonly (() => void)[];
}

/**
 * Discovers, whitelists, and loads plugins for one server process. Loading is
 * opt-in: only bundled plugins (shipped with the runtime) and ids listed in
 * `Plugins.Enabled` are loaded. Broken plugins never abort the host — each
 * failure is recorded and reported by `senera plugins list`.
 *
 * Registered tools and skills are applied to each runtime composition through
 * `applyTools`; commands, hooks, and approval transports take effect at the
 * process level through their shared registries.
 */
export class AgentPluginHost {
  private readonly sources: readonly AgentPluginDiscoverySource[];
  private readonly enabled: ReadonlySet<string>;
  private readonly approvalTransports?: AgentApprovalTransportRegistry;
  private readonly loadEntry: AgentPluginEntryLoader;
  private readonly hooks = new AgentPluginHookRegistry();
  private descriptors: readonly AgentPluginDescriptor[] = [];
  private discoveryErrorList: readonly AgentPluginDiscoveryError[] = [];
  private loaded = new Map<string, LoadedAgentPlugin>();
  private loadErrors = new Map<string, string>();
  private discovered = false;
  private loadedState: "idle" | "loaded" = "idle";
  private started = false;
  private shutdownPromise: Promise<void> | undefined;

  constructor(options: AgentPluginHostOptions) {
    this.sources = options.sources;
    this.enabled = new Set((options.enabled ?? []).map((id) => id.trim()).filter(Boolean));
    this.approvalTransports = options.approvalTransports;
    this.loadEntry = options.loadEntry ?? loadPluginEntryModule;
  }

  /** Runs discovery; safe to call once at startup. Never throws. */
  discover(): void {
    const result = discoverAgentPlugins(this.sources);
    this.descriptors = result.plugins.map((plugin) => ({
      ...plugin,
      enabled: plugin.builtin || this.enabled.has(plugin.manifest.id),
    }));
    this.discoveryErrorList = result.errors;
    this.discovered = true;
  }

  /** Loads every enabled plugin in dependency order. Never throws; failures
   * are recorded per plugin and surfaced by `list()`. */
  async load(): Promise<void> {
    this.assertDiscovered();
    if (this.loadedState === "loaded") return;
    const ordered = orderEnabledPlugins(this.descriptors);
    this.loadErrors = new Map(ordered.errors.map((error) => [error.pluginId, error.message]));
    for (const plugin of ordered.ordered) {
      if (this.loadErrors.has(plugin.manifest.id)) continue;
      const result = await this.loadPlugin(plugin);
      if (result) this.loaded.set(plugin.manifest.id, result);
    }
    this.loadedState = "loaded";
  }

  /** Runs `onStart` hooks of every loaded plugin, in registration order. */
  async start(): Promise<void> {
    await this.hooks.run("onStart");
    this.started = true;
  }

  /** Runs `onShutdown` hooks of every loaded plugin. */
  async shutdown(): Promise<void> {
    this.shutdownPromise ??= this.shutdownOnce();
    return this.shutdownPromise;
  }

  /** Applies plugin-registered tools and skills into one runtime composition
   * registry. Idempotent per registry; each composition owns its own registry. */
  applyTools(registry: AgentExtensionRegistry): void {
    for (const loaded of this.loaded.values()) {
      if (loaded.tools.length > 0) {
        registry.registerToolExtension(pluginExtensionOwner(loaded.plugin), loaded.tools);
      }
      if (loaded.skills.length > 0) {
        registry.replaceSkills(pluginSkillSourceIdentity(loaded.plugin), loaded.skills);
      }
    }
  }

  /** Snapshot for `senera plugins list`. */
  list(): readonly AgentPluginListEntry[] {
    this.assertDiscovered();
    return this.descriptors.map((plugin) => {
      const loaded = this.loaded.get(plugin.manifest.id);
      return {
        id: plugin.manifest.id,
        name: plugin.manifest.name ?? plugin.manifest.id,
        version: plugin.manifest.version,
        kind: plugin.manifest.kind,
        description: plugin.manifest.description,
        source: plugin.source,
        builtin: plugin.builtin,
        enabled: plugin.enabled,
        directory: plugin.directory,
        requires: plugin.manifest.requires ?? [],
        loaded: loaded !== undefined,
        ...(loaded === undefined && this.loadErrors.has(plugin.manifest.id)
          ? { error: this.loadErrors.get(plugin.manifest.id) }
          : {}),
      };
    });
  }

  loadedPluginCount(): number {
    return this.loaded.size;
  }

  isStarted(): boolean {
    return this.started;
  }

  /** Discovery-time manifest errors (invalid JSON, duplicate ids). */
  discoveryErrors(): readonly AgentPluginDiscoveryError[] {
    return this.discoveryErrorList;
  }

  private assertDiscovered(): void {
    if (!this.discovered) {
      throw new Error("AgentPluginHost.discover() must run before loading plugins.");
    }
  }

  private async loadPlugin(plugin: AgentPluginDescriptor): Promise<LoadedAgentPlugin | undefined> {
    const tools: RegisteredTool[] = [];
    const skills: RegisteredSkill[] = [];
    const cleanup: Array<() => void> = [];
    let module: AgentPluginEntryModule;
    try {
      module = await this.loadEntry(plugin.directory, plugin.manifest.entry);
    } catch (error) {
      this.loadErrors.set(plugin.manifest.id, `无法加载插件入口: ${errorMessage(error)}`);
      return undefined;
    }
    if (!module || typeof module.register !== "function") {
      this.loadErrors.set(plugin.manifest.id, `插件入口未导出 register(ctx) 函数: ${plugin.manifest.entry}`);
      return undefined;
    }
    const context = this.createRegistrationContext(plugin, tools, skills, cleanup);
    try {
      await module.register(context);
    } catch (error) {
      for (const undo of cleanup.reverse()) undo();
      this.loadErrors.set(plugin.manifest.id, `插件 register(ctx) 失败: ${errorMessage(error)}`);
      return undefined;
    }
    return { plugin, tools, skills, cleanup };
  }

  private createRegistrationContext(
    plugin: AgentPluginDescriptor,
    tools: RegisteredTool[],
    skills: RegisteredSkill[],
    cleanup: Array<() => void>,
  ): AgentPluginRegistrationContext {
    const context: AgentPluginRegistrationContext = {
      plugin,
      registerTool: (registered) => tools.push(...stampPluginToolOwners(plugin, registered)),
      registerSkill: (registered) => skills.push(...projectPluginSkills(plugin, registered)),
      registerCommand: (spec, handler) => cleanup.push(registerAgentSelfCommand(spec, handler, plugin.manifest.id)),
      registerHook: (hook) => cleanup.push(this.hooks.register(hook)),
      registerApprovalTransport: (transport) => cleanup.push(this.registerTransport(plugin, transport)),
    };
    return context;
  }

  private registerTransport(plugin: AgentPluginDescriptor, transport: AgentApprovalTransport): () => void {
    if (!this.approvalTransports) {
      throw new Error(`插件 ${plugin.manifest.id} 注册审批传输 ${transport.name}，但宿主未提供审批传输注册表。`);
    }
    return this.approvalTransports.register(transport);
  }

  private async shutdownOnce(): Promise<void> {
    const failures: unknown[] = [];
    for (const hook of this.hooks.list()) {
      if (hook.name !== "onShutdown") continue;
      try {
        await hook.handler();
      } catch (error) {
        failures.push(error);
      }
    }
    for (const loaded of [...this.loaded.values()].reverse()) {
      for (const undo of [...loaded.cleanup].reverse()) {
        try {
          undo();
        } catch (error) {
          failures.push(error);
        }
      }
    }
    this.loaded.clear();
    this.started = false;
    this.loadedState = "idle";
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Plugin shutdown failed.");
  }
}

/** Entry module loader for the real host. The entry path must resolve inside
 * the plugin directory — a manifest escaping its own root is rejected. */
async function loadPluginEntryModule(directory: string, entry: string): Promise<AgentPluginEntryModule> {
  const resolved = new URL(`file://${pathJoinEntry(directory, entry)}`);
  return (await import(/* @vite-ignore */ resolved.href)) as AgentPluginEntryModule;
}

function pathJoinEntry(directory: string, entry: string): string {
  if (entry.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(entry) || entry.includes("..")) {
    throw new Error(`非法插件入口路径: ${entry}（必须相对于插件目录）`);
  }
  return `${directory.replaceAll("\\", "/").replace(/\/+$/u, "")}/${entry.replace(/^\.?\//u, "")}`;
}

function orderEnabledPlugins(descriptors: readonly AgentPluginDescriptor[]): {
  readonly ordered: readonly AgentPluginDescriptor[];
  readonly errors: readonly AgentPluginLoadError[];
} {
  const byId = new Map(descriptors.map((plugin) => [plugin.manifest.id, plugin]));
  const ordered: AgentPluginDescriptor[] = [];
  const errors: AgentPluginLoadError[] = [];
  const failed = new Set<string>();
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (plugin: AgentPluginDescriptor): void => {
    if (failed.has(plugin.manifest.id) || visited.has(plugin.manifest.id)) return;
    if (visiting.has(plugin.manifest.id)) {
      const message = `插件依赖循环: ${[...visiting, plugin.manifest.id].join(" -> ")}`;
      errors.push({ pluginId: plugin.manifest.id, message });
      failed.add(plugin.manifest.id);
      return;
    }
    visiting.add(plugin.manifest.id);
    for (const requirement of plugin.manifest.requires ?? []) {
      const dependency = byId.get(requirement);
      if (!dependency) {
        const message = `依赖的插件不存在: ${requirement}`;
        errors.push({ pluginId: plugin.manifest.id, message });
        failed.add(plugin.manifest.id);
        continue;
      }
      if (!dependency.enabled) {
        const message = `依赖的插件未启用: ${requirement}（加入 Plugins.Enabled 白名单）`;
        errors.push({ pluginId: plugin.manifest.id, message });
        failed.add(plugin.manifest.id);
        continue;
      }
      visit(dependency);
      if (failed.has(dependency.manifest.id)) {
        failed.add(plugin.manifest.id);
      }
    }
    visiting.delete(plugin.manifest.id);
    if (!failed.has(plugin.manifest.id)) {
      visited.add(plugin.manifest.id);
      ordered.push(plugin);
    }
  };

  for (const plugin of descriptors) {
    if (plugin.enabled) visit(plugin);
  }
  return { ordered, errors };
}

/** Plugin tools share one owner identity so the extension registry resolves
 * name collisions with the system and MCP tiers deterministically (plugin
 * rank is lowest). */
export function pluginExtensionOwner(plugin: AgentPluginDescriptor): AgentExtensionOwner {
  return {
    kind: "plugin",
    name: plugin.manifest.id,
    title: plugin.manifest.name ?? plugin.manifest.id,
    rootPath: plugin.directory,
    revision: plugin.manifest.version,
    priority: 2,
    trusted: plugin.builtin,
    requiresApproval: false,
  };
}

function pluginSkillSourceIdentity(plugin: AgentPluginDescriptor): string {
  return `standalone:plugin:${plugin.manifest.id}`;
}

/** Plugin authors register tools without knowing the owner identity convention;
 * the host stamps the plugin owner so extension-tier priority and collision
 * resolution stay deterministic. */
function stampPluginToolOwners(plugin: AgentPluginDescriptor, tools: readonly RegisteredTool[]): RegisteredTool[] {
  const owner = pluginExtensionOwner(plugin);
  return tools.map((tool) => ({ ...tool, owner }));
}

function projectPluginSkills(plugin: AgentPluginDescriptor, skills: readonly RegisteredSkill[]): RegisteredSkill[] {
  return skills.map((skill) => ({
    ...skill,
    source: {
      kind: "standalone",
      id: `plugin:${plugin.manifest.id}`,
      displayName: plugin.manifest.name ?? plugin.manifest.id,
    },
  }));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
