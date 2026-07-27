export const AgentConfigSecretContract = {
  RedactedPlaceholder: "__senera_redacted_secret__",
} as const;

export function isAgentConfigRedactedSecret(value: unknown): boolean {
  return value === AgentConfigSecretContract.RedactedPlaceholder;
}
