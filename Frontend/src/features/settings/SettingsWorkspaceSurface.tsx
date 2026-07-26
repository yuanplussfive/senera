import type { ReactNode } from "react";
import { cn } from "../../lib/util";

export function SettingsWorkspaceFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return <section className={cn("overflow-hidden bg-paper-50", className)}>{children}</section>;
}
