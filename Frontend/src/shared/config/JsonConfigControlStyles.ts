import { cn } from "../../lib/util";

export const jsonConfigInputClassName = cn(
  "h-8 w-full min-w-0 border border-ink-200 bg-paper-100 px-2.5 text-[12.5px] text-ink-800",
  "outline-none transition placeholder:text-ink-400",
  "focus:border-accent-border focus:ring-2 focus:ring-accent-focus",
  "disabled:pointer-events-none disabled:opacity-55",
);
