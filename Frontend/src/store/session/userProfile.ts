import type { ConversationIdentityData, UserProfileData } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";

export type ConversationIdentity = ConversationIdentityData;

export const UserProfileSyncStates = {
  Synced: "synced",
  Pending: "pending",
} as const;
export const USER_PROFILE_SYNC_STATES = [UserProfileSyncStates.Synced, UserProfileSyncStates.Pending] as const;
export type UserProfileSyncState = (typeof USER_PROFILE_SYNC_STATES)[number];

export type UserProfile = Omit<UserProfileData, "assistant"> & {
  assistant: ConversationIdentity;
  syncState?: UserProfileSyncState;
};

export type ConversationProfileUpdate = Pick<UserProfile, "name" | "avatarDataUrl" | "avatarPath" | "assistant">;

export const DEFAULT_ASSISTANT_PROFILE: ConversationIdentity = {
  name: frontendMessage("profile.defaultAssistantName"),
  avatarDataUrl: null,
};

export const DEFAULT_USER_PROFILE: UserProfile = {
  name: frontendMessage("profile.defaultName"),
  avatarDataUrl: null,
  assistant: DEFAULT_ASSISTANT_PROFILE,
  updatedAt: "",
};

export function normalizeUserProfile(value: unknown): UserProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_USER_PROFILE;
  const profile = value as Partial<UserProfile>;
  const identity = normalizeConversationIdentity(profile, DEFAULT_USER_PROFILE);
  return {
    ...identity,
    assistant: normalizeConversationIdentity(profile.assistant, DEFAULT_ASSISTANT_PROFILE),
    updatedAt: typeof profile.updatedAt === "string" ? profile.updatedAt : "",
    syncState:
      profile.syncState === UserProfileSyncStates.Pending
        ? UserProfileSyncStates.Pending
        : UserProfileSyncStates.Synced,
  };
}

function normalizeConversationIdentity(value: unknown, defaults: ConversationIdentity): ConversationIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
  const identity = value as Partial<ConversationIdentity>;
  const normalized: ConversationIdentity = {
    name: typeof identity.name === "string" && identity.name.trim() ? identity.name.trim().slice(0, 48) : defaults.name,
    avatarDataUrl:
      typeof identity.avatarDataUrl === "string" && identity.avatarDataUrl.trim() ? identity.avatarDataUrl : null,
  };
  if ("avatarPath" in identity) {
    normalized.avatarPath =
      typeof identity.avatarPath === "string" && identity.avatarPath.trim() ? identity.avatarPath : null;
  }
  return normalized;
}
