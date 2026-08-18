export const AgentConfigSecretContract = {
  RedactedPlaceholder: "__senera_redacted_secret__",
} as const;

const SensitiveHeaderNamePattern = /auth|key|token|secret|cookie|password|credential|signature/i;
const SensitiveFieldNamePattern = /(?:api[-_]?key|access[-_]?token|auth[-_]?token|token|secret|password|credential)$/i;

export function isAgentConfigRedactedSecret(value: unknown): boolean {
  return value === AgentConfigSecretContract.RedactedPlaceholder;
}

export function isAgentConfigSensitiveHeaderName(name: string): boolean {
  return SensitiveHeaderNamePattern.test(name);
}

/**
 * Configuration fields use stricter matching than HTTP headers so ordinary
 * extension options such as "monkey" never become encrypted by accident.
 */
export function isAgentConfigSensitiveFieldName(name: string): boolean {
  return SensitiveFieldNamePattern.test(name);
}
