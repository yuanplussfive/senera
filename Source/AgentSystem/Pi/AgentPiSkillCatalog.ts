import path from "node:path";
import type { Skill as HarnessSkill } from "@earendil-works/pi-agent-core";
import type { Skill as CodingAgentSkill } from "@earendil-works/pi-coding-agent";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import { agentSkillLogicalUri } from "../Skills/AgentSkillResourceUri.js";
import type { RegisteredSkill } from "../Skills/AgentSkillTypes.js";

export interface AgentPiSkillCatalog {
  readonly fingerprint: string;
  readonly skills: readonly CodingAgentSkill[];
}

/** Uses the registry's resolved priorities; Pi does not discover a second catalog. */
export function projectAgentPiSkillCatalog(
  registered: readonly RegisteredSkill[],
  activated: readonly AgentActivatedSkill[] = [],
): AgentPiSkillCatalog {
  const resources = new Map(
    registered.map((skill) => [
      skill.name,
      {
        name: skill.name,
        description: skill.description,
        filePath: skill.descriptionFile,
        content: skill.content,
        revision: skill.revision,
        disableModelInvocation: skill.disableModelInvocation === true,
      },
    ]),
  );
  // Activation can outlive a directory update while preparation awaits I/O.
  // Keep its selected revision in the directory for this turn as well.
  for (const skill of activated) {
    resources.set(skill.name, {
      name: skill.name,
      description: skill.summary,
      filePath: skill.descriptionFile,
      content: skill.content,
      revision: skill.revision,
      disableModelInvocation: skill.disableModelInvocation === true,
    });
  }
  const snapshot = [...resources.values()].sort((left, right) => left.name.localeCompare(right.name));
  return {
    fingerprint: sha256HexOfCanonicalJson(snapshot),
    skills: snapshot.map((skill) => {
      const filePath = path.resolve(skill.filePath);
      const baseDir = path.dirname(filePath);
      return {
        name: skill.name,
        description: skill.description,
        filePath,
        baseDir,
        disableModelInvocation: skill.disableModelInvocation,
        sourceInfo: { path: filePath, source: "senera", scope: "project", origin: "top-level", baseDir },
      };
    }),
  };
}

export function projectAgentPiActivatedSkills(activated: readonly AgentActivatedSkill[] = []): HarnessSkill[] {
  return activated.map((skill) => ({
    name: skill.name,
    description: skill.summary,
    content: skill.content,
    filePath: agentSkillLogicalUri(skill.name),
    disableModelInvocation: skill.disableModelInvocation === true,
  }));
}
