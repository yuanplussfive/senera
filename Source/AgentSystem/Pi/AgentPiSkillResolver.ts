import type { Skill as HarnessSkill } from "@earendil-works/pi-agent-core";
import type { ResourceDiagnostic, Skill as CodingAgentSkill } from "@earendil-works/pi-coding-agent";
import { groupAgentValuesBy } from "../Core/AgentCollections.js";
import { readRegularTextFileSync } from "../Core/AgentFs.js";
import { isSamePath, toPosixPath } from "../Core/AgentPath.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import { parseAgentSkillDocument } from "../Skills/AgentSkillDocument.js";

export interface AgentPiLoadedSkillCatalog {
  readonly skills: readonly CodingAgentSkill[];
  readonly diagnostics: readonly ResourceDiagnostic[];
}

export class AgentPiSkillResolver {
  resolve(activatedSkills: readonly AgentActivatedSkill[] = [], catalog: AgentPiLoadedSkillCatalog): HarnessSkill[] {
    const collisionsByName = new Map(
      catalog.diagnostics.flatMap((diagnostic) => {
        const collision = diagnostic.collision;
        return collision?.resourceType === "skill" ? [[collision.name, collision] as const] : [];
      }),
    );
    const loadedByName = groupAgentValuesBy(catalog.skills, (skill) => skill.name);

    return activatedSkills.map((activated) => {
      const collision = collisionsByName.get(activated.name);
      if (collision) {
        throw new Error(
          `Pi Skill ${activated.name} is ambiguous between ${collision.winnerPath} and ${collision.loserPath}.`,
        );
      }

      const named = loadedByName.get(activated.name) ?? [];
      const matching = named.filter((skill) => isSamePath(skill.filePath, activated.descriptionFile));
      if (matching.length !== 1) {
        throw skillResolutionError(activated, named);
      }

      const skill = matching[0];
      if (!skill) throw skillResolutionError(activated, named);
      return {
        name: skill.name,
        description: skill.description,
        content: readSkillBody(skill.filePath),
        filePath: toPosixPath(skill.filePath),
        disableModelInvocation: skill.disableModelInvocation,
      };
    });
  }
}

function skillResolutionError(activated: AgentActivatedSkill, named: readonly CodingAgentSkill[]): Error {
  const loadedLocations = named.map((skill) => skill.filePath);
  const suffix = loadedLocations.length > 0 ? ` Pi loaded this name from: ${loadedLocations.join(", ")}.` : "";
  return new Error(
    `Activated Skill ${activated.name} at ${activated.descriptionFile} is absent from the Pi ResourceLoader catalog.${suffix}`,
  );
}

function readSkillBody(filePath: string): string {
  return parseAgentSkillDocument(readRegularTextFileSync(filePath, "Pi Skill source")).content.trim();
}
