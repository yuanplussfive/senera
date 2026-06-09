import {
  ContextMenuItem,
  ContextMenuSeparator,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "../../shared/ui";
import type { SessionMenuAction, SessionMenuSection } from "./types";

interface SessionMenuItemsProps {
  actions: readonly SessionMenuAction[];
  separateLast?: boolean;
}

export function DropdownSessionMenuItems({ actions, separateLast = false }: SessionMenuItemsProps): JSX.Element {
  return (
    <>
      {actions.map((action, index) => (
        <div key={action.id}>
          {separateLast && index === actions.length - 1 ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem
            icon={action.icon}
            destructive={action.destructive}
            disabled={action.disabled}
            shortcut={action.shortcut}
            onSelect={action.onSelect}
          >
            {action.label}
          </DropdownMenuItem>
        </div>
      ))}
    </>
  );
}

export function ContextSessionMenuItems({ actions, separateLast = false }: SessionMenuItemsProps): JSX.Element {
  return (
    <>
      {actions.map((action, index) => (
        <div key={action.id}>
          {separateLast && index === actions.length - 1 ? <ContextMenuSeparator /> : null}
          <ContextMenuItem
            icon={action.icon}
            destructive={action.destructive}
            disabled={action.disabled}
            shortcut={action.shortcut}
            onSelect={action.onSelect}
          >
            {action.label}
          </ContextMenuItem>
        </div>
      ))}
    </>
  );
}

export function DropdownSessionMenuSections({
  sections,
}: {
  sections: readonly SessionMenuSection[];
}): JSX.Element {
  return (
    <>
      {sections.map((section, index) => (
        <div key={section.section}>
          {index > 0 ? <DropdownMenuSeparator /> : null}
          <DropdownMenuLabel>{section.section}</DropdownMenuLabel>
          <DropdownSessionMenuItems actions={section.items} />
        </div>
      ))}
    </>
  );
}
