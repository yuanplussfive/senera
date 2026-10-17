import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { AgentConfigService } from "../Source/AgentSystem/Config/AgentConfigService.js";
import type { AgentSessionStore } from "../Source/AgentSystem/Session/AgentSessionStore.js";
import type { AgentWorkspaceLogStore } from "../Source/AgentSystem/Diagnostics/AgentWorkspaceLogStore.js";
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
  /** Active configuration file path, exposed by `senera config env-path`. */
  readonly configPath?: string;
  /** Session store for `senera sessions list`. */
  readonly sessionStore?: AgentSessionStore;
  /** Workspace-local structured log store for `senera logs`. */
  readonly logStore?: AgentWorkspaceLogStore;
  /** Plugin host for `senera plugins list`. */
  readonly pluginHost?: AgentPluginHost;
  /** Ordered Skill roots; earlier sources win only when a name is unique. */
  readonly skillSources?: readonly AgentSelfSkillSource[];
}

/** Builds the self-service port from the live host services. Optional service
 * segments fail deterministically when a host does not bind them. */
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
    sessions: input.sessionStore ? createSessionsPort(input.sessionStore) : undefined,
    status: {
      manifest: () => readAgentRuntimeManifest(input.workspaceRoot),
    },
    logs: input.logStore ? createLogsPort(input.logStore) : undefined,
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

function createLogsPort(store: AgentWorkspaceLogStore): NonNullable<AgentSelfServicePort["logs"]> {
  return {
    root: () => store.root,
    list: () => store.listFiles(),
    read: (name, lines) => store.readFile(name, lines),
    query: (query) => store.query(query),
    detail: (detailId) => store.detail(detailId),
    health: () => store.health(),
    streams: () => store.listStreams(),
  };
}
