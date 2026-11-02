const ReferencePrefix = "memos:";

/**
 * Converts a package-validated public reference into the native MemOS node
 * id. This is domain translation, not a second model-facing schema parser.
 */
export function parseAgentMemOSReference(reference: string): string {
  if (!reference.startsWith(ReferencePrefix) || reference.length === ReferencePrefix.length) {
    throw new Error(`Invalid MemOS reference: ${reference}`);
  }
  return reference.slice(ReferencePrefix.length);
}

export function agentMemOSReference(nodeId: string): string {
  return `${ReferencePrefix}${nodeId}`;
}
