import { useState } from "react";
import type { SystemExtensionSettingsItem } from "../../../api/eventTypes";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { AppIcon, Button, Tooltip } from "../../../shared/ui";

/** Package contributions and declared tool associations use the same live catalog. */
export function PluginSkills({ skills }: { skills: SystemExtensionSettingsItem["skills"] }): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  if (!skills?.length) return null;
  const visible = expanded ? skills : skills.slice(0, 4);
  return (
    <section className="mb-7" data-plugin-skills>
      <h4 className="mb-2 flex items-baseline gap-2 text-[14px] font-semibold text-content-primary">
        {frontendMessage("settings.entitySummary.skills")}
        <span className="text-xs font-normal tabular-nums text-content-muted">{skills.length}</span>
      </h4>
      <div className="divide-y divide-line-subtle">
        {visible.map((skill) => (
          <div key={skill.name} className="flex min-w-0 items-start gap-3 py-3">
            <AppIcon icon="book-open" size={17} className="mt-0.5 shrink-0 text-content-muted" />
            <div className="min-w-0">
              <Tooltip content={skill.name}>
                <p className="w-fit max-w-full truncate text-[13px] font-medium text-content-primary">
                  {skill.title || skill.name}
                </p>
              </Tooltip>
              <p className="mt-1 text-xs leading-5 text-content-secondary">{skill.description}</p>
            </div>
          </div>
        ))}
      </div>
      {skills.length > 4 ? (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 mt-1 gap-1.5"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          {frontendMessage(expanded ? "workflow.workspace.showLess" : "workflow.workspace.showMore", {
            count: skills.length - 4,
          })}
          <AppIcon icon={expanded ? "chevron-up" : "chevron-down"} size={14} />
        </Button>
      ) : null}
    </section>
  );
}
