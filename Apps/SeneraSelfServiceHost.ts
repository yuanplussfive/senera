import fs from "node:fs";
import path from "node:path";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { AgentConfigService } from "../Source/AgentSystem/Config/AgentConfigService.js";
import type { AgentPresetActivationRuntime } from "../Source/AgentSystem/Presets/AgentPresetActivationRuntime.js";
import { AgentPresetManager } from "../Source/AgentSystem/Presets/AgentPresetManager.js";
import { resolvePresetsConfig as resolvePresetsConfigValue } from "../Source/AgentSystem/AgentDefaults.js";
import type { AgentSessionStore } from "../Source/AgentSystem/Session/AgentSessionStore.js";
import type {
  AgentSelfServicePort,
  AgentSelfSessionSummary,
  AgentSelfSkillSource,
} from "../Source/AgentSystem/SelfService/AgentSelfServiceTypes.js";
import { createAgentSelfSkillsPort } from "../Source/AgentSystem/SelfService/AgentSelfSkills.js";
import { readAgentRuntimeManifest } from "../Source/AgentSystem/Runtime/AgentRuntimeManifest.js";
import type { AgentPluginHost } from "../Source/AgentSystem/Plugins/AgentPluginHost.js";
import { resolveAgentSessionModelProviderId } from "../Source/AgentSystem/ModelEndpoints/AgentModelMetadata.js";

export interface SeneraSelfServicePortInput {
  readonly workspaceRoot: string;
  readonly configSnapshot: () => AgentSystemConfig;
  readonly configService: AgentConfigService;
  readonly presetActivation: AgentPresetActivationRuntime;
  readonly resolvePresetsConfig: typeof resolvePresetsConfigValue;
  /** Active configuration file path, exposed by `senera config env-path`. */
  readonly configPath?: string;
  /** Session store for `senera sessions list`. */
  readonly sessionStore?: AgentSessionStore;
  /** Log directory for `senera logs list/tail`; files must carry a `.log` suffix. */
  readonly logsRoot?: string;
  /** Plugin host for `senera plugins list`. */
  readonly pluginHost?: AgentPluginHost;
  /** Ordered Skill roots; earlier sources win only when a name is unique. */
  readonly skillSources?: readonly AgentSelfSkillSource[];
}

/** Builds the self-service port from the live host services. Preset managers
 * are created per invocation so preset reads always observe the latest
 * configuration and repository state. The sessions/status/logs segments are
 * optional: when a host does not bind them, the corresponding commands fail
 * deterministically instead of approximating. */
export function createSeneraSelfServicePort(input: SeneraSelfServicePortInput): AgentSelfServicePort {
  return {
    workspaceRoot: input.workspaceRoot,
    configPath: input.configPath,
    config: {
      getSnapshot: () => input.configService.snapshot(),
      replace: (replaceInput) => input.configService.replaceConfig(replaceInput),
      history: () => input.configService.history(),
      readRevision: (revision) => input.configService.readRevision(revision),
    },
    presets: {
      manager: () =>
        new AgentPresetManager({
          workspaceRoot: input.workspaceRoot,
          config: input.resolvePresetsConfig(input.configSnapshot()),
          activation: input.presetActivation,
        }),
    },
    sessions: input.sessionStore ? createSessionsPort(input.sessionStore) : undefined,
    status: {
      manifest: () => readAgentRuntimeManifest(input.workspaceRoot),
    },
    logs: input.logsRoot ? createLogsPort(input.logsRoot) : undefined,
    plugins: input.pluginHost ? createPluginsPort(input.pluginHost) : undefined,
    skills: input.skillSources ? createAgentSelfSkillsPort(input.skillSources) : undefined,
  };
}

function createPluginsPort(host: AgentPluginHost): NonNullable<AgentSelfServicePort["plugins"]> {
  return {
    list: () => host.list(),
    discoveryErrors: () => host.discoveryErrors(),
  };
}

function createSessionsPort(store: AgentSessionStore): NonNullable<AgentSelfServicePort["sessions"]> {
  return {
    list: (): readonly AgentSelfSessionSummary[] =>
      store.listSessions().map((session) => {
        const modelProviderId = resolveAgentSessionModelProviderId(session.metadata);
        return {
          id: session.id,
          title: session.metadata?.title ?? "(未命名会话)",
          messageCount: session.messageCount,
          entryCount: session.entryCount,
          updatedAt: session.updatedAt,
          ...(modelProviderId ? { modelProviderId } : {}),
        };
      }),
    getModelPreference: (sessionId) => store.getSessionModelPreference(sessionId),
    getModelRuntime: (sessionId) => store.getSessionModelRuntime(sessionId),
    setModelPreference: (sessionId, modelProviderId, source) =>
      store.setSessionModelPreference(sessionId, modelProviderId, source),
    snapshot: (sessionId) => store.getSessionSnapshot(sessionId),
  };
}

function createLogsPort(root: string): NonNullable<AgentSelfServicePort["logs"]> {
  return {
    root: () => root,
    list: () => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(root, { withFileTypes: true });
      } catch {
        return [];
      }
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".log"))
        .map((entry) => {
          const stat = fs.statSync(path.join(root, entry.name));
          return { name: entry.name, sizeBytes: stat.size, updatedAt: stat.mtime.toISOString() };
        })
        .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    },
    read: (name, lines) => {
      if (name.includes("..") || /[\\/]/.test(name)) {
        return { status: "rejected" as const, error: `非法的日志文件名: ${name}` };
      }
      const target = path.resolve(root, name);
      if (target !== root && !target.startsWith(root + path.sep)) {
        return { status: "rejected" as const, error: "日志文件路径越界。" };
      }
      try {
        const content = fs.readFileSync(target, "utf8");
        return { status: "found" as const, content: content.split(/\r?\n/).slice(-lines).join("\n") };
      } catch {
        return { status: "missing" as const, error: `日志文件不存在: ${name}` };
      }
    },
  };
}
