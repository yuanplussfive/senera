import { useRef, type ReactNode } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { FluidHoverHighlight, useFluidHover, useMotionLevel } from "../../shared/motion";
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
  const { disableMotion } = useMotionLevel();
  const listRef = useRef<HTMLElement>(null);
  const hover = useFluidHover(listRef, { axis: "x", gapClick: false });
  // The active tool paints its own background and ring; the layer yields there.
  const activeToolIndex = items.findIndex((item) => item.active);
  if (items.length === 0) return null;

  return (
    <nav
      ref={listRef}
      className="relative ml-auto flex items-center gap-0.5"
      aria-label={frontendMessage("workflow.dock.label")}
      data-workspace-tool-dock
      data-workflow-dock-trigger="header"
      {...hover.handlers}
    >
      <FluidHoverHighlight
        hover={hover}
        hidden={disableMotion || hover.activeIndex === activeToolIndex}
        className="rounded-md"
      />
      {items.map((item, index) => (
        <IconButton
          key={item.id}
          ref={hover.getItemRef(index)}
          label={item.label}
          tooltip={item.label}
          tooltipSide="bottom"
          aria-pressed={item.active}
          aria-expanded={Boolean(item.active)}
          disabled={item.disabled}
          onClick={item.onSelect}
          className={cn(
            "relative z-10 h-7 w-7 rounded-md",
            !disableMotion && "hover:bg-transparent",
            item.active && "bg-ink-900/[0.07] text-ink-900 shadow-[inset_0_0_0_1px_rgb(var(--color-ink-200)/0.7)]",
          )}
        >
          {item.icon}
        </IconButton>
      ))}
    </nav>
  );
}
