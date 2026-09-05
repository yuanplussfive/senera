import matter from "gray-matter";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const AgentSkillMatterOptions = {
  engines: {
    yaml: {
      parse: (source: string) => parseYaml(source),
      stringify: (value: unknown) => stringifyYaml(value),
    },
  },
};

export function parseAgentSkillDocument(source: string) {
  return matter(normalizeLineEndings(source), AgentSkillMatterOptions);
}

export function stringifyAgentSkillDocument(content: string, frontmatter: Readonly<Record<string, unknown>>): string {
  return matter.stringify(content, frontmatter, AgentSkillMatterOptions);
}

function normalizeLineEndings(value: string): string {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}
