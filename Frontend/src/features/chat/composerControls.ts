import { cn } from "../../lib/util";

/** Shared geometry for every control in the composer toolbar. */
export function composerControlClassName(prefersCompactControls: boolean): string {
  return prefersCompactControls ? "h-11 min-h-11" : "h-8 min-h-8";
}

export function composerIconControlClassName(prefersCompactControls: boolean): string {
  return cn(composerControlClassName(prefersCompactControls), prefersCompactControls ? "w-11 min-w-11" : "w-8 min-w-8");
}
