import { cn } from "../../lib/util";

export const jsonConfigInputClassName = cn(
  "h-9 w-full min-w-0 rounded-md border border-line bg-surface-panel px-3 text-[12.5px] text-content-primary",
  "outline-none transition-[background-color,border-color,box-shadow] placeholder:text-content-muted",
  "focus:border-accent-border focus:ring-2 focus:ring-accent-focus",
  "disabled:pointer-events-none disabled:opacity-55",
);
