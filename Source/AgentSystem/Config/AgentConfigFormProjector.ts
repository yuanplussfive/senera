import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { AgentConfigFormSnapshot } from "../Types/ConfigFormTypes.js";
import { projectEffectiveConfig } from "./AgentConfigEffectiveProjector.js";
import { projectConfigFormField } from "./AgentConfigFormFieldProjector.js";
import { readConfigFormDocument } from "./AgentConfigFormDocument.js";

export function projectAgentConfigForm(config: AgentSystemConfig): AgentConfigFormSnapshot {
  const document = readConfigFormDocument();
  const source = config as unknown as Record<string, unknown>;
  const effectiveSource = projectEffectiveConfig(config) as unknown as Record<string, unknown>;

  return {
    version: document.form.version,
    sections: (document.form.sections ?? [])
      .filter((section) => section.level !== "internal")
      .map((section) => {
        const fields = (section.fields ?? [])
          .filter((field) => field.level !== "internal")
          .map((field) => projectConfigFormField({
            field,
            section: section.id,
            source,
            effectiveSource,
            basePath: [],
          }));
        return {
          name: section.id,
          label: section.label,
          description: section.description,
          icon: section.icon,
          keyCount: fields.length,
          fields,
        };
      }),
  };
}
