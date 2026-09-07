const ExplicitSkillInvocation = /\$([a-z0-9]+(?:-[a-z0-9]+)*)/gu;

export function parseAgentExplicitSkillNames(input: string | undefined): string[] {
  if (!input) return [];
  return [...new Set([...input.matchAll(ExplicitSkillInvocation)].map((match) => match[1]).filter(isText))];
}

function isText(value: string | undefined): value is string {
  return Boolean(value);
}
