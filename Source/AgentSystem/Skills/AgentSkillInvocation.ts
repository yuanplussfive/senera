import type { RegisteredSkill } from "./AgentSkillTypes.js";

const ExplicitSkillInvocation = /(?:^|\s)\$([a-z0-9]+(?:-[a-z0-9]+)*)\b/gu;
const SlashSkillInvocation = /(?:^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)\b(?=$|\s|[,.!?;:])/gu;

export type AgentSkillInvocationSyntax = "slash" | "dollar";

export interface AgentSkillInvocation {
  readonly name: string;
  readonly syntax: AgentSkillInvocationSyntax;
  readonly token: string;
  readonly offset: number;
}

/**
 * Parses explicit Skill commands without treating URLs or filesystem paths
 * as commands. Slash syntax is canonical; `$skill` remains a compatibility
 * spelling for existing prompts and learned examples.
 */
export function parseAgentSkillInvocations(input: string | undefined): AgentSkillInvocation[] {
  if (!input) return [];
  const matches: AgentSkillInvocation[] = [];
  for (const match of input.matchAll(SlashSkillInvocation)) {
    const name = match[1];
    if (!name) continue;
    const offset = match.index ?? 0;
    matches.push({ name, syntax: "slash", token: `/${name}`, offset });
  }
  for (const match of input.matchAll(ExplicitSkillInvocation)) {
    const name = match[1];
    if (!name) continue;
    const offset = match.index ?? 0;
    matches.push({ name, syntax: "dollar", token: `$${name}`, offset });
  }
  const seen = new Set<string>();
  return matches
    .sort((left, right) => left.offset - right.offset || syntaxRank(left.syntax) - syntaxRank(right.syntax))
    .filter((invocation) => {
      if (seen.has(invocation.name)) return false;
      seen.add(invocation.name);
      return true;
    });
}

export function parseAgentExplicitSkillNames(input: string | undefined): string[] {
  return parseAgentSkillInvocations(input).map((invocation) => invocation.name);
}

export class AgentSkillInvocationRegistry {
  private readonly commands: ReadonlyMap<string, RegisteredSkill>;

  constructor(skills: readonly RegisteredSkill[]) {
    const commands = new Map<string, RegisteredSkill>();
    for (const skill of skills) {
      if (commands.has(skill.name)) {
        throw new Error(`Skill invocation is ambiguous: /${skill.name}.`);
      }
      commands.set(skill.name, skill);
    }
    this.commands = commands;
  }

  list(): readonly AgentSkillInvocationCommand[] {
    return [...this.commands.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((skill) => ({
        command: `/${skill.name}`,
        name: skill.name,
        description: skill.description,
        revision: skill.revision ?? skill.source.id,
      }));
  }

  resolve(name: string): RegisteredSkill | undefined {
    return this.commands.get(name.trim().replace(/^\//u, ""));
  }
}

export interface AgentSkillInvocationCommand {
  readonly command: string;
  readonly name: string;
  readonly description: string;
  readonly revision: string;
}

/** Model routing is opt-out per Skill package. Explicit invocations are
 * validated separately by AgentSkillInvocationRegistry and may still select
 * a non-routable Skill. */
export function isAgentSkillModelInvocable(skill: RegisteredSkill): boolean {
  return skill.disableModelInvocation !== true;
}

function syntaxRank(syntax: AgentSkillInvocationSyntax): number {
  return syntax === "slash" ? 0 : 1;
}
