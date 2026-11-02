/** The storage key is host-owned; never share preferences between workspaces. */
export function readAgentQqClientPreferencesKey(): string {
  const key = document.querySelector<HTMLMetaElement>('meta[name="senera-qq-options-key"]')?.content;
  if (!key) throw new Error("Senera QQ requires workspace-scoped preferences.");
  return key;
}

/** Keep the existing encoded storage format so installed clients retain their settings. */
export function parseAgentQqClientPreferences(serialized: string | null): Record<string, string> {
  const options: Record<string, string> = Object.create(null);
  for (const entry of (serialized ?? "").split("&")) {
    const separator = entry.indexOf(":");
    if (separator > 0) options[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return options;
}

export function serializeAgentQqClientPreferences(options: Readonly<Record<string, string>>): string {
  return Object.entries(options)
    .map(([key, value]) => `${key}:${value}`)
    .join("&");
}
