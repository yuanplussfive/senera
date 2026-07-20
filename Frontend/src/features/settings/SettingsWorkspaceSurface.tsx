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

export function SettingsWorkspaceState({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div
      className={cn(
        "grid min-h-[360px] place-items-center bg-paper-50 px-6 text-center text-[13px] text-ink-400",
        className,
      )}
    >
      {children}
    </div>
  );
}
