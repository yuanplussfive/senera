import { z } from "zod";
import type { AgentDomainEvent, AgentEventSink } from "../Events/AgentEvent.js";
import { AgentEventKinds, emitAgentEvent } from "../Events/AgentEvent.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import type { AgentDirectory } from "../Profile/AgentDirectory.js";
import {
  AgentProfileAvatarIdentities,
  type AgentProfileAvatarIdentity,
  AgentProfileAvatarStore,
} from "./AgentProfileAvatarStore.js";

import {
  AgentProfileIdentityInputSchema,
  AgentUserProfileInputSchema,
  AgentUserProfileSchema,
  type AgentUserProfileInput,
  type AgentUserProfile,
  type AgentProfileIdentity,
  AgentUserProfileUpdateSchema,
  type AgentUserProfileUpdate,
} from "../Core/AgentProfileContract.js";
export * from "../Core/AgentProfileContract.js";

export interface AgentUserProfileRepository {
  loadUserProfile(): AgentUserProfile;
  saveUserProfile(profile: AgentUserProfileInput): AgentUserProfile;
}

export function createDefaultAgentUserProfile(updatedAt = new Date().toISOString()): AgentUserProfile {
  return {
    name: agentErrorMessage("session.profileDefaultName"),
    avatarDataUrl: null,
    avatarPath: null,
    assistant: createDefaultAgentAssistantProfile(),
    updatedAt,
  };
}

export function createDefaultAgentAssistantProfile(): AgentProfileIdentity {
  return {
    name: agentErrorMessage("session.profileDefaultAssistantName"),
    avatarDataUrl: null,
    avatarPath: null,
  };
}

export function createAgentProfileIdentity(
  input: z.input<typeof AgentProfileIdentityInputSchema>,
): AgentProfileIdentity {
  const parsed = AgentProfileIdentityInputSchema.parse(input);
  return {
    name: parsed.name,
    avatarDataUrl: parsed.avatarDataUrl ?? null,
    avatarPath: parsed.avatarPath ?? null,
  };
}

export function createAgentUserProfile(
  input: AgentUserProfileInput,
  updatedAt = new Date().toISOString(),
): AgentUserProfile {
  const parsed = AgentUserProfileInputSchema.parse(input);
  return {
    name: parsed.name,
    avatarDataUrl: parsed.avatarDataUrl ?? null,
    avatarPath: parsed.avatarPath ?? null,
    assistant: parsed.assistant ? createAgentProfileIdentity(parsed.assistant) : createDefaultAgentAssistantProfile(),
    updatedAt,
  };
}

export function parseStoredAgentUserProfile(value: unknown, updatedAt?: string): AgentUserProfile {
  const snapshot = AgentUserProfileSchema.safeParse(value);
  if (snapshot.success) return snapshot.data;

  const input = AgentUserProfileInputSchema.safeParse(value);
  if (input.success) {
    return createAgentUserProfile(input.data, updatedAt);
  }

  return createDefaultAgentUserProfile(updatedAt);
}

export class AgentUserProfileManager {
  constructor(
    private readonly repository: AgentUserProfileRepository,
    private readonly avatarStore?: AgentProfileAvatarStore,
    private readonly directory?: AgentDirectory,
  ) {}

  async emitSnapshot(request: { onEvent?: AgentEventSink }): Promise<void> {
    const current = this.currentProfile();
    const materialized = await this.materialize(current);
    const profile = hasAvatarStateChanged(current, materialized)
      ? this.repository.saveUserProfile(toProfileInput(materialized))
      : current;
    await emitAgentEvent(request.onEvent, this.snapshotEvent(profile));
  }

  async updateProfile(request: { profile: AgentUserProfileUpdate; onEvent?: AgentEventSink }): Promise<void> {
    const current = this.currentProfile();
    const requested = createAgentUserProfile({
      ...AgentUserProfileUpdateSchema.parse(request.profile),
      assistant: current.assistant,
    });
    const materialized = await this.materialize(requested);
    const profile = this.repository.saveUserProfile(toProfileInput(materialized));
    await this.removeReplacedAvatars(current, profile);
    await emitAgentEvent(request.onEvent, this.snapshotEvent(profile));
  }

  private async removeReplacedAvatars(previous: AgentUserProfile, next: AgentUserProfile): Promise<void> {
    if (!this.avatarStore) return;
    await Promise.all([
      previous.avatarPath !== next.avatarPath
        ? this.avatarStore.remove(AgentProfileAvatarIdentities.User, previous.avatarPath)
        : undefined,
      previous.assistant.avatarPath !== next.assistant.avatarPath &&
      !this.directory?.snapshot().agents.some((agent) => agent.avatarPath === previous.assistant.avatarPath)
        ? this.avatarStore.remove(AgentProfileAvatarIdentities.Assistant, previous.assistant.avatarPath)
        : undefined,
    ]).catch(() => undefined);
  }

  private currentProfile(): AgentUserProfile {
    const profile = this.repository.loadUserProfile();
    const agent = this.directory?.get();
    return agent
      ? { ...profile, assistant: { name: agent.name, avatarPath: agent.avatarPath, avatarDataUrl: null } }
      : profile;
  }

  private async materialize(profile: AgentUserProfile): Promise<AgentUserProfile> {
    if (!this.avatarStore) return profile;
    const user = await this.materializeIdentity(profile, AgentProfileAvatarIdentities.User);
    const assistant = await this.materializeIdentity(profile.assistant, AgentProfileAvatarIdentities.Assistant);
    return {
      name: user.name,
      avatarDataUrl: user.avatarDataUrl,
      avatarPath: user.avatarPath,
      assistant,
      updatedAt: profile.updatedAt,
    };
  }

  private async materializeIdentity(
    identity: AgentProfileIdentity,
    kind: AgentProfileAvatarIdentity,
  ): Promise<AgentProfileIdentity> {
    if (identity.avatarPath && (await this.avatarStore!.isReadable(kind, identity.avatarPath))) {
      return { ...identity, avatarDataUrl: null };
    }
    if (identity.avatarDataUrl) {
      try {
        const avatarPath = await this.avatarStore!.saveDataUrl(kind, identity.avatarDataUrl);
        return { ...identity, avatarDataUrl: null, avatarPath };
      } catch {
        return { ...identity, avatarDataUrl: null, avatarPath: null };
      }
    }
    return { ...identity, avatarDataUrl: null, avatarPath: null };
  }

  private snapshotEvent(profile: AgentUserProfile): AgentDomainEvent {
    return {
      kind: AgentEventKinds.ProfileSnapshot,
      context: {},
      data: profile,
    };
  }
}

function toProfileInput(profile: AgentUserProfile): AgentUserProfileInput {
  return {
    name: profile.name,
    avatarDataUrl: profile.avatarDataUrl,
    avatarPath: profile.avatarPath,
    assistant: profile.assistant,
  };
}

function hasAvatarStateChanged(left: AgentUserProfile, right: AgentUserProfile): boolean {
  return (
    left.avatarDataUrl !== right.avatarDataUrl ||
    left.avatarPath !== right.avatarPath ||
    left.assistant.avatarDataUrl !== right.assistant.avatarDataUrl ||
    left.assistant.avatarPath !== right.assistant.avatarPath
  );
}
