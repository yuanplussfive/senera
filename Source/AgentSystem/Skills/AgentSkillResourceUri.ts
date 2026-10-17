/** Stable model-facing identity for a Skill package.
 *
 * This is deliberately not a filesystem path. Package resources must be
 * resolved by the SeneraCommand host using the Skill name and relative path,
 * so a desktop, container, and remote runtime expose the same prompt. */
export function agentSkillLogicalUri(name: string): string {
  const normalized = name.trim();
  if (!normalized) throw new Error("Skill name is required for a logical resource URI.");
  return `senera://skills/${encodeURIComponent(normalized)}/SKILL.md`;
}
