/**
 * A package declares which product settings surface owns its configuration.
 * This is intentionally package metadata, so a settings feature never has to
 * infer ownership from an extension ID, Tool name, or capability prefix.
 */
export const AgentSystemExtensionSettingsSurfaceValues = ["system-tools", "channels"] as const;

export type AgentSystemExtensionSettingsSurface = (typeof AgentSystemExtensionSettingsSurfaceValues)[number];

export const AgentSystemExtensionSettingsSurfaces = {
  SystemTools: "system-tools",
  Channels: "channels",
} as const satisfies Record<string, AgentSystemExtensionSettingsSurface>;
