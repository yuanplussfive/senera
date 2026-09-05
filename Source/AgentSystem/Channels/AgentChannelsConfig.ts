import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import {
  AgentChannelBusyMessageModes,
  AgentChannelKinds,
  type AgentChannelBusyMessageMode,
  type AgentChannelConfig,
  type AgentChannelKind,
  type AgentChannelsConfig,
} from "./AgentChannelTypes.js";

export const AgentChannelsExtensionId = "agent-channels";

export const AgentChannelConfigDefaults: Readonly<Record<AgentChannelKind, AgentChannelConfig>> = {
  telegram: {
    enabled: false,
    allowAllUsers: false,
    busyMessageMode: AgentChannelBusyMessageModes.Steer,
  },
  qq: {
    enabled: false,
    // QQ's settings contract explicitly defaults to an open admission gate.
    // Operators can opt out and provide an allowlist when the bot is exposed
    // beyond a trusted/private deployment.
    allowAllUsers: true,
    busyMessageMode: AgentChannelBusyMessageModes.Steer,
  },
  discord: {
    enabled: false,
    allowAllUsers: false,
    busyMessageMode: AgentChannelBusyMessageModes.Steer,
  },
};

/** Subsystem-level defaults every channel inherits unless it overrides them. */
export interface AgentChannelSubsystemDefaults {
  readonly busyMessageMode: AgentChannelBusyMessageMode;
}

/**
 * Resolves the channel gateway configuration from the agent-channels system
 * extension. Unknown fields are tolerated so older runtimes can read newer
 * configuration files; every field that changes behavior is typed first.
 */
export function resolveAgentChannelsConfig(config: AgentSystemConfig): AgentChannelsConfig {
  const raw = config.Extensions?.[AgentChannelsExtensionId]?.Configuration;
  if (!raw || typeof raw !== "object") {
    return { enabled: false, defaultApprovalMode: "agent", channels: cloneDefaults() };
  }
  const channels: Record<AgentChannelKind, AgentChannelConfig> = cloneDefaults();
  const source = raw as Record<string, unknown>;
  // The subsystem switch is opt-out to match the settings UI default
  // (`draft?.enabled ?? true`): per-channel `enabled` gates each adapter, so a
  // missing master field must not silently disable the whole subsystem.
  const enabled = source.enabled !== false;
  const defaultApprovalMode =
    source.defaultApprovalMode === "always_ask" || source.defaultApprovalMode === "full_access"
      ? source.defaultApprovalMode
      : "agent";
  const subsystemDefaults: AgentChannelSubsystemDefaults = {
    busyMessageMode: busyMessageModeField(source.busyMessageMode) ?? AgentChannelBusyMessageModes.Steer,
  };
  channels.telegram = resolveChannelConfig(AgentChannelKinds.Telegram, source.telegram, subsystemDefaults);
  channels.qq = resolveChannelConfig(AgentChannelKinds.Qq, source.qq, subsystemDefaults);
  channels.discord = resolveChannelConfig(AgentChannelKinds.Discord, source.discord, subsystemDefaults);
  return { enabled, defaultApprovalMode, channels };
}

function resolveChannelConfig(
  kind: AgentChannelKind,
  value: unknown,
  subsystemDefaults: AgentChannelSubsystemDefaults,
): AgentChannelConfig {
  const defaults = AgentChannelConfigDefaults[kind];
  if (!value || typeof value !== "object") {
    return { ...defaults, ...subsystemDefaults };
  }
  const raw = value as Record<string, unknown>;
  return {
    enabled: raw.enabled === true,
    token: stringField(raw.token),
    // Hermes-compatible deployments commonly keep QQ credentials in the
    // process environment. Configuration wins, but blank fields must not
    // shadow QQ_APP_ID / QQ_CLIENT_SECRET.
    appId: stringField(firstValue(raw.appId, raw.app_id, process.env.QQ_APP_ID)),
    appSecret: stringField(firstValue(raw.appSecret, raw.client_secret, process.env.QQ_CLIENT_SECRET)),
    webhookUrl: stringField(firstValue(raw.webhookUrl, raw.webhook_url)),
    webhookSecret: stringField(firstValue(raw.webhookSecret, raw.webhook_secret)),
    mode: resolveMode(kind, firstValue(raw.mode, raw.transport)),
    allowedUsers: stringArrayField(firstValue(raw.allowedUsers, raw.allow_from, raw.allowFrom)),
    allowedRoles: stringArrayField(firstValue(raw.allowedRoles, raw.allowed_roles)),
    // Preserve the declared channel default: QQ is open by contract while
    // Telegram and Discord remain closed unless explicitly opted in.
    allowAllUsers: typeof raw.allowAllUsers === "boolean" ? raw.allowAllUsers : (defaults.allowAllUsers ?? false),
    requireMention: firstValue(raw.requireMention, raw.require_mention) === true,
    groupSessionsPerUser: firstValue(raw.groupSessionsPerUser, raw.group_sessions_per_user) === true,
    homeChannelId: stringField(firstValue(raw.homeChannelId, raw.home_channel_id)),
    maxMessageLength: intField(firstValue(raw.maxMessageLength, raw.max_message_length)),
    streamProgress:
      typeof firstValue(raw.streamProgress, raw.stream_progress) === "boolean"
        ? (firstValue(raw.streamProgress, raw.stream_progress) as boolean)
        : true,
    markdownSupport: booleanField(firstValue(raw.markdownSupport, raw.markdown_support)),
    intents: intField(raw.intents),
    ackTimeoutMs: intField(firstValue(raw.ackTimeoutMs, raw.ack_timeout_ms)),
    maxReconnectAttempts: intField(firstValue(raw.maxReconnectAttempts, raw.max_reconnect_attempts)),
    quickDisconnectThresholdMs: intField(firstValue(raw.quickDisconnectThresholdMs, raw.quick_disconnect_threshold_ms)),
    maxQuickDisconnects: intField(firstValue(raw.maxQuickDisconnects, raw.max_quick_disconnects)),
    quickDisconnectCooldownMs: intField(firstValue(raw.quickDisconnectCooldownMs, raw.quick_disconnect_cooldown_ms)),
    maxMediaBytes: intField(firstValue(raw.maxMediaBytes, raw.max_media_bytes)),
    inlineMediaLimitBytes: intField(firstValue(raw.inlineMediaLimitBytes, raw.inline_media_limit_bytes)),
    mediaUploadTimeoutMs: intField(firstValue(raw.mediaUploadTimeoutMs, raw.media_upload_timeout_ms)),
    chunkUploadTimeoutMs: intField(firstValue(raw.chunkUploadTimeoutMs, raw.chunk_upload_timeout_ms)),
    uploadConcurrency: intField(firstValue(raw.uploadConcurrency, raw.upload_concurrency)),
    mediaCacheTtlMs: intField(firstValue(raw.mediaCacheTtlMs, raw.media_cache_ttl_ms)),
    typingDebounceMs: intField(firstValue(raw.typingDebounceMs, raw.typing_debounce_ms)),
    dmPolicy: policyField(firstValue(raw.dmPolicy, raw.dm_policy)),
    groupPolicy: policyField(firstValue(raw.groupPolicy, raw.group_policy)),
    groupAllowedUsers: stringArrayField(firstValue(raw.groupAllowedUsers, raw.groupAllowFrom, raw.group_allow_from)),
    dedupWindowMs: intField(firstValue(raw.dedupWindowMs, raw.dedup_window_ms)),
    dedupMaxSize: intField(firstValue(raw.dedupMaxSize, raw.dedup_max_size)),
    busyMessageMode:
      busyMessageModeField(firstValue(raw.busyMessageMode, raw.busy_message_mode)) ?? subsystemDefaults.busyMessageMode,
    stt: recordField(raw.stt),
    unknown: collectUnknown(raw),
  };
}

function resolveMode(kind: AgentChannelKind, value: unknown): string | undefined {
  if (kind === AgentChannelKinds.Qq) {
    return value === "webhook" ? "webhook" : "websocket";
  }
  if (kind === AgentChannelKinds.Telegram) {
    return value === "webhook" ? "webhook" : "long_polling";
  }
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function collectUnknown(raw: Record<string, unknown>): Record<string, unknown> | undefined {
  const known = new Set([
    "enabled",
    "token",
    "appId",
    "app_id",
    "appSecret",
    "client_secret",
    "webhookUrl",
    "webhook_url",
    "webhookSecret",
    "webhook_secret",
    "mode",
    "transport",
    "allowedUsers",
    "allow_from",
    "allowFrom",
    "allowedRoles",
    "allowed_roles",
    "allowAllUsers",
    "requireMention",
    "require_mention",
    "groupSessionsPerUser",
    "group_sessions_per_user",
    "homeChannelId",
    "home_channel_id",
    "maxMessageLength",
    "max_message_length",
    "streamProgress",
    "stream_progress",
    "markdownSupport",
    "markdown_support",
    "intents",
    "ackTimeoutMs",
    "ack_timeout_ms",
    "maxReconnectAttempts",
    "max_reconnect_attempts",
    "quickDisconnectThresholdMs",
    "quick_disconnect_threshold_ms",
    "maxQuickDisconnects",
    "max_quick_disconnects",
    "quickDisconnectCooldownMs",
    "quick_disconnect_cooldown_ms",
    "maxMediaBytes",
    "max_media_bytes",
    "inlineMediaLimitBytes",
    "inline_media_limit_bytes",
    "mediaUploadTimeoutMs",
    "media_upload_timeout_ms",
    "chunkUploadTimeoutMs",
    "chunk_upload_timeout_ms",
    "uploadConcurrency",
    "upload_concurrency",
    "mediaCacheTtlMs",
    "media_cache_ttl_ms",
    "typingDebounceMs",
    "typing_debounce_ms",
    "dmPolicy",
    "dm_policy",
    "groupPolicy",
    "group_policy",
    "groupAllowedUsers",
    "groupAllowFrom",
    "group_allow_from",
    "dedupWindowMs",
    "dedup_window_ms",
    "dedupMaxSize",
    "dedup_max_size",
    "busyMessageMode",
    "busy_message_mode",
    "stt",
  ]);
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!known.has(key)) extra[key] = value;
  }
  return Object.keys(extra).length > 0 ? extra : undefined;
}

function policyField(value: unknown): AgentChannelConfig["dmPolicy"] {
  return value === "disabled" || value === "allowlist" || value === "pairing" || value === "open" ? value : undefined;
}

function busyMessageModeField(value: unknown): AgentChannelBusyMessageMode | undefined {
  return value === AgentChannelBusyMessageModes.Steer || value === AgentChannelBusyMessageModes.FollowUp
    ? value
    : undefined;
}

function cloneDefaults(): Record<AgentChannelKind, AgentChannelConfig> {
  return { ...AgentChannelConfigDefaults };
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function stringArrayField(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return items.length > 0 ? items : undefined;
}

function intField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function recordField(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Readonly<Record<string, unknown>>;
}

function booleanField(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** Prefer the first meaningful value while allowing empty canonical fields to
 * fall through to a Hermes-compatible alias. Boolean false remains valid. */
function firstValue(...values: readonly unknown[]): unknown {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim().length === 0) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    return value;
  }
  return undefined;
}
