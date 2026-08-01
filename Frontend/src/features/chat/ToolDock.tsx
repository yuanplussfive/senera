import type { ReactNode } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { IconButton } from "../../shared/ui";

export interface ToolDockItem {
  id: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export function ToolDock({ items }: { items: ToolDockItem[] }): JSX.Element | null {
  if (items.length === 0) return null;

  return (
    <nav
      className="ml-auto flex items-center gap-0.5"
      aria-label={frontendMessage("workflow.dock.label")}
      data-workspace-tool-dock
    >
      {items.map((item) => (
        <IconButton
          key={item.id}
          label={item.label}
          tooltip={item.label}
          tooltipSide="bottom"
          aria-pressed={item.active}
          aria-expanded={Boolean(item.active)}
          disabled={item.disabled}
          onClick={item.onSelect}
          className={cn("h-7 w-7 rounded-md", item.active && "bg-ink-900/[0.07] text-ink-900")}
        >
          {item.icon}
        </IconButton>
      ))}
    </nav>
  );
}
