export const AgentConfigSecretContract = {
  RedactedPlaceholder: "__senera_redacted_secret__",
} as const;

const SensitiveHeaderNamePattern = /auth|key|token|secret|cookie|password|credential|signature/i;

export function isAgentConfigRedactedSecret(value: unknown): boolean {
  return value === AgentConfigSecretContract.RedactedPlaceholder;
}

export function isAgentConfigSensitiveHeaderName(name: string): boolean {
  return SensitiveHeaderNamePattern.test(name);
}
