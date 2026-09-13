import type { AgentSelfServicePort, AgentSelfCommandOutput } from "../SelfService/AgentSelfServiceTypes.js";
import type { AgentSelfCommandExecutionOptions } from "../SelfService/AgentSelfApprovalTypes.js";
import type { AgentSelfCommandSpec } from "../SelfService/AgentSelfCommandRegistry.js";
import type { AgentApprovalTransport } from "../SelfService/AgentApprovalTransport.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import type { RegisteredSkill } from "../Skills/AgentSkillTypes.js";
import type { AgentPluginDescriptor } from "./AgentPluginTypes.js";

/** Lifecycle hooks a plugin may register. Bounded on purpose: hooks are
 * deterministic ordering points, not a general event bus. */
export const AgentPluginHookNames = {
  OnStart: "onStart",
  OnShutdown: "onShutdown",
} as const;
export type AgentPluginHookName = (typeof AgentPluginHookNames)[keyof typeof AgentPluginHookNames];

export interface AgentPluginHook {
  readonly name: AgentPluginHookName;
  readonly handler: () => void | Promise<void>;
}

/** Handler for a plugin-registered `senera` command. Receives the raw trailing
 * arguments after the plugin command root/action; parsing is the plugin's
 * responsibility, so command surfaces stay unbounded without touching the
 * core schema. */
export type AgentPluginCommandHandler = (
  args: readonly string[],
  port: AgentSelfServicePort,
  options: AgentSelfCommandExecutionOptions,
) => Promise<AgentSelfCommandOutput>;

/** The `register(ctx)` extension surface handed to a plugin entry module.
 * Each method writes into a host registry; duplicate registrations fail the
 * plugin load with a deterministic error. */
export interface AgentPluginRegistrationContext {
  readonly plugin: AgentPluginDescriptor;
  registerTool(tools: readonly RegisteredTool[]): void;
  registerSkill(skills: readonly RegisteredSkill[]): void;
  registerCommand(spec: AgentSelfCommandSpec, handler: AgentPluginCommandHandler): void;
  registerHook(hook: AgentPluginHook): void;
  registerApprovalTransport(transport: AgentApprovalTransport): void;
}

export class AgentPluginHookRegistry {
  private readonly hooks: AgentPluginHook[] = [];

  register(hook: AgentPluginHook): () => void {
    if (!Object.values(AgentPluginHookNames).includes(hook.name)) {
      throw new Error(`Unknown plugin hook name: ${hook.name}`);
    }
    this.hooks.push(hook);
    return () => {
      const index = this.hooks.indexOf(hook);
      if (index >= 0) this.hooks.splice(index, 1);
    };
  }

  async run(name: AgentPluginHookName): Promise<void> {
    for (const hook of this.hooks) {
      if (hook.name === name) await hook.handler();
    }
  }

  list(): AgentPluginHook[] {
    return [...this.hooks];
  }
}
