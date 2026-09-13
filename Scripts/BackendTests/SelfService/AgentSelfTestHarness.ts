import type {
  AgentConfigHistoryEntry,
  AgentConfigReplaceInput,
  AgentConfigSnapshot,
} from "../../../Source/AgentSystem/Config/AgentConfigService.js";
import type { AgentSelfServicePort } from "../../../Source/AgentSystem/SelfService/AgentSelfServiceTypes.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

export interface AgentSelfTestConfigRevision {
  readonly revision: number;
  readonly config: AgentSystemConfig;
  readonly source: AgentConfigHistoryEntry["source"];
  readonly createdAt: string;
}

export interface AgentSelfTestConfigPort {
  readonly port: () => Pick<AgentSelfServicePort, "config">;
  readonly replaceCalls: AgentConfigReplaceInput[];
}

/** In-memory config port that mirrors the live host contract: every replace
 * appends a revision, history lists retained entries, and readRevision returns
 * the committed configuration for adjudication and rollback replay. */
export function createAgentSelfTestConfigPort(
  initial: AgentSystemConfig,
  history: readonly AgentSelfTestConfigRevision[] = [],
): AgentSelfTestConfigPort {
  let revision = history.length > 0 ? history.at(-1)!.revision : 7;
  let value = structuredClone(initial);
  const replaceCalls: AgentConfigReplaceInput[] = [];
  const entries: AgentConfigHistoryEntry[] = history.map(({ revision: entry, source, createdAt }) => ({
    revision: entry,
    source,
    createdAt,
  }));
  const revisions = new Map<number, AgentSystemConfig>(
    history.map(({ revision: entry, config }) => [entry, structuredClone(config)]),
  );
  return {
    replaceCalls,
    port: () => ({
      config: {
        getSnapshot: () => createAgentTestSnapshot(value, revision),
        replace: (input) => {
          replaceCalls.push(input);
          value = structuredClone(input.config);
          revision += 1;
          entries.push({ revision, source: input.source ?? "api_update", createdAt: new Date().toISOString() });
          revisions.set(revision, structuredClone(value));
          return createAgentTestSnapshot(value, revision);
        },
        history: () => entries,
        readRevision: (target) => {
          const found = revisions.get(target);
          return found ? { status: "found", value: found } : { status: "missing" };
        },
      },
    }),
  };
}

export function createAgentTestSnapshot(config: AgentSystemConfig, revision = 7): AgentConfigSnapshot {
  return {
    path: "senera.config.json",
    version: revision,
    value: config,
    source: "json",
    revision,
    diagnostics: [],
    form: { sections: [], coverage: { omissions: [] } },
  } as unknown as AgentConfigSnapshot;
}
