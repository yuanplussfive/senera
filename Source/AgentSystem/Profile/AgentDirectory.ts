import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AgentDirectoryCommandSchema,
  AgentDirectorySnapshotSchema,
  WorkspaceAgentGroupSchema,
  type AgentDirectoryCommand,
  type AgentDirectoryRepository,
  type AgentDirectorySnapshot,
  type WorkspaceAgent,
} from "../Core/AgentDirectoryContract.js";
import type { AgentProfileIdentity } from "../Session/AgentUserProfile.js";
import type { AgentPromptPresetManifest } from "../Core/AgentPromptPresetContract.js";
import { AgentIdentityDomains, type AgentEntityReferences } from "../Identity/AgentShortId.js";

export class AgentDirectoryConflictError extends Error {}

/** Retired activation filters are migrated once; live groups always use autonomous participation. */
const LegacyDirectorySchema = z
  .object({
    ...AgentDirectorySnapshotSchema.shape,
    version: z.literal(1),
    groups: z.array(WorkspaceAgentGroupSchema.extend({ replyPolicy: z.enum(["addressed", "all"]) })),
  })
  .omit({ deletingAgentIds: true })
  .strict();
const DirectoryV2Schema = z
  .object({ ...AgentDirectorySnapshotSchema.shape, version: z.literal(2) })
  .omit({ deletingAgentIds: true });

function loadDirectory(stored: unknown): AgentDirectorySnapshot {
  if (typeof stored === "object" && stored !== null && "version" in stored && stored.version === 1) {
    const legacy = LegacyDirectorySchema.parse(stored);
    return AgentDirectorySnapshotSchema.parse({
      ...legacy,
      version: 3,
      deletingAgentIds: [],
      revision: legacy.revision + 1,
      groups: legacy.groups.map(({ replyPolicy: _retired, ...group }) => group),
    });
  }
  if (typeof stored === "object" && stored !== null && "version" in stored && stored.version === 2) {
    const previous = DirectoryV2Schema.parse(stored);
    return AgentDirectorySnapshotSchema.parse({
      ...previous,
      version: 3,
      deletingAgentIds: [],
      revision: previous.revision + 1,
    });
  }
  return AgentDirectorySnapshotSchema.parse(stored);
}

/** Workspace authority for persistent Agents and local channel membership. */
export class AgentDirectory {
  private state: AgentDirectorySnapshot;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly repository: AgentDirectoryRepository,
    initial: {
      assistant: AgentProfileIdentity;
      preset?: AgentPromptPresetManifest;
    },
    private readonly references: AgentEntityReferences,
  ) {
    const stored = repository.loadAgentDirectory();
    if (stored !== undefined) {
      this.state = loadDirectory(stored);
      this.state.agents = this.state.agents.map((agent) => ({
        ...agent,
        reference: references.allocate(AgentIdentityDomains.Agent, agent.id, agent.reference),
      }));
      repository.saveAgentDirectory(this.state);
      return;
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    this.state = AgentDirectorySnapshotSchema.parse({
      version: 3,
      deletingAgentIds: [],
      revision: 0,
      defaultAgentId: id,
      operatorId: null,
      groups: [],
      agents: [
        {
          id,
          reference: references.allocate(AgentIdentityDomains.Agent, id),
          name: initial.assistant.name,
          avatarPath: initial.assistant.avatarPath,
          enabled: true,
          modelProviderId: null,
          presetPath: initial.preset?.activePath ?? null,
          presetEnabled: initial.preset?.enabled ?? false,
          qqUserId: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    repository.saveAgentDirectory(this.state);
  }

  snapshot(): AgentDirectorySnapshot {
    return structuredClone(this.state);
  }

  get(id = this.state.defaultAgentId): WorkspaceAgent {
    const agent = this.state.agents.find((entry) => entry.id === id || entry.reference === id);
    if (!agent) throw new Error(`Unknown Agent: ${id}.`);
    return structuredClone(agent);
  }

  resolve(id?: string): WorkspaceAgent {
    const agent = this.get(id);
    if (this.state.deletingAgentIds.includes(agent.id)) throw new Error(`Agent ${agent.name} is being deleted.`);
    if (!agent.enabled) throw new Error(`Agent ${agent.name} is disabled.`);
    return agent;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  execute(command: AgentDirectoryCommand): AgentDirectorySnapshot {
    const parsed = AgentDirectoryCommandSchema.parse(command);
    if (parsed.revision !== this.state.revision)
      throw new AgentDirectoryConflictError("Agent settings changed. Refresh before saving.");
    const next = this.snapshot();
    const now = new Date().toISOString();
    switch (parsed.type) {
      case "agent.create": {
        const id = randomUUID();
        next.agents.push({
          ...parsed.agent,
          id,
          reference: this.references.allocate(AgentIdentityDomains.Agent, id),
          qqUserId: next.operatorId === null ? null : this.allocateIdentity(next),
          createdAt: now,
          updatedAt: now,
        });
        break;
      }
      case "agent.update": {
        if (next.deletingAgentIds.includes(parsed.id)) throw new Error("A deleting Agent cannot be edited.");
        const index = next.agents.findIndex((entry) => entry.id === parsed.id);
        if (index < 0) throw new Error("The Agent no longer exists.");
        next.agents[index] = { ...next.agents[index], ...parsed.agent, updatedAt: now };
        break;
      }
      case "agent.default":
        next.defaultAgentId = this.resolve(parsed.id).id;
        break;
      case "agent.delete": {
        const agent = this.get(parsed.id);
        if (agent.id === next.defaultAgentId)
          throw new Error("Select another default Agent before deleting this Agent.");
        if (!next.deletingAgentIds.includes(agent.id)) next.deletingAgentIds.push(agent.id);
        next.agents = next.agents.map((entry) =>
          entry.id === agent.id ? { ...entry, enabled: false, updatedAt: now } : entry,
        );
        break;
      }
      case "group.create":
        for (const id of parsed.group.memberAgentIds) this.resolve(id);
        next.groups.push({ ...parsed.group, id: this.allocateIdentity(next), createdAt: now, updatedAt: now });
        break;
      case "group.update": {
        const index = next.groups.findIndex((entry) => entry.id === parsed.id);
        if (index < 0) throw new Error("The group no longer exists.");
        for (const id of parsed.group.memberAgentIds) {
          if (!next.groups[index].memberAgentIds.includes(id)) this.resolve(id);
          if (next.deletingAgentIds.includes(id)) throw new Error("A deleting Agent cannot be a group member.");
        }
        next.groups[index] = { ...next.groups[index], ...parsed.group, updatedAt: now };
        break;
      }
    }
    this.commit(next);
    return this.snapshot();
  }

  /** Commit deletion only after the host has stopped work and removed owned data. */
  completeDeletion(id: string): AgentDirectorySnapshot {
    if (!this.state.deletingAgentIds.includes(id)) throw new Error("Agent deletion has not been prepared.");
    const next = this.snapshot();
    next.agents = next.agents.filter((agent) => agent.id !== id);
    next.groups = next.groups.flatMap((group) => {
      const memberAgentIds = group.memberAgentIds.filter((member) => member !== id);
      return memberAgentIds.length ? [{ ...group, memberAgentIds }] : [];
    });
    next.deletingAgentIds = next.deletingAgentIds.filter((entry) => entry !== id);
    this.commit(next);
    return this.snapshot();
  }

  /** One-time migration preserves the QQ identities already visible to the client. */
  importLegacyGroups(groups: readonly { id: string; name: string }[]): void {
    const next = this.snapshot();
    const now = new Date().toISOString();
    for (const group of groups) {
      const id = Number(group.id);
      if (next.groups.some((entry) => entry.id === id)) continue;
      next.groups.push({ id, name: group.name, memberAgentIds: [next.agents[0].id], createdAt: now, updatedAt: now });
    }
    if (next.groups.length !== this.state.groups.length) this.commit(next);
  }

  bindOneBotIdentity(selfId: number, operatorId: number): void {
    const next = this.snapshot();
    if (next.operatorId !== null && next.operatorId !== operatorId)
      throw new Error("The OneBot operator identity conflicts with the Agent directory.");
    // selfId imports the original contact only. Once bound, the directory owns
    // every contact identity even if that original Agent has since been deleted.
    if (next.operatorId === operatorId && next.agents.every((entry) => entry.qqUserId !== null)) return;
    const first = next.agents[0];
    if (first.qqUserId !== null && first.qqUserId !== selfId)
      throw new Error("The OneBot assistant identity conflicts with the Agent directory.");
    next.operatorId = operatorId;
    first.qqUserId = selfId;
    for (const agent of next.agents) {
      if (agent.qqUserId === null) agent.qqUserId = this.allocateIdentity(next);
    }
    this.commit(next);
  }

  private allocateIdentity(snapshot: AgentDirectorySnapshot): number {
    const used = new Set([
      snapshot.operatorId,
      ...snapshot.agents.map((agent) => agent.qqUserId),
      ...snapshot.groups.map((group) => group.id),
    ]);
    let id: number;
    do {
      id = randomInt(100_000_000, 1_000_000_000);
    } while (used.has(id));
    return id;
  }

  private commit(next: AgentDirectorySnapshot): void {
    next.revision = this.state.revision + 1;
    const snapshot = AgentDirectorySnapshotSchema.parse(next);
    this.repository.saveAgentDirectory(snapshot);
    this.state = snapshot;
    for (const listener of this.listeners) listener();
  }
}
