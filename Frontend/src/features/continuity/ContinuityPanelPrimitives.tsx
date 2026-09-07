import type { ReactNode } from "react";
import type { FrontendMessageKey } from "../../i18n/frontendMessageCatalog";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";

export function ContinuityGroup({
  id,
  title,
  summary,
  children,
}: {
  id: "identity" | "recall" | "conditions" | "agenda";
  /** Kept for call-site compatibility; group headings intentionally stay icon-free. */
  icon?: unknown;
  title: FrontendMessageKey;
  summary?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="px-4 py-3" data-continuity-group={id}>
      <header className="mb-2.5 flex min-h-6 items-baseline gap-2 border-b border-line-subtle pb-2">
        <h3 className="min-w-0 flex-1 truncate text-[11px] font-medium leading-5 text-content-primary">
          {frontendMessage(title)}
        </h3>
        {summary ? (
          <span className="shrink-0 text-[9px] tabular-nums leading-4 text-content-muted">{summary}</span>
        ) : null}
      </header>
      <div className="space-y-3.5">{children}</div>
    </section>
  );
}

export function ContinuitySubsection({
  title,
  children,
}: {
  /** Kept for call-site compatibility; subsection headings intentionally stay icon-free. */
  icon?: unknown;
  title: FrontendMessageKey;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="first:mt-0">
      <div className="mb-1.5 flex min-h-5 items-center border-l border-accent-border pl-2 text-[10px] font-medium leading-4 text-content-secondary">
        <h4 className="min-w-0 flex-1 truncate">{frontendMessage(title)}</h4>
      </div>
      {children}
    </div>
  );
}

export function ContinuityEmptyText({ children }: { children: ReactNode }): JSX.Element {
  return <p className="text-[10.5px] leading-5 text-content-muted">{children}</p>;
}

export function ContinuityDetail({
  label,
  value,
  compact = false,
}: {
  label: FrontendMessageKey;
  value: string;
  compact?: boolean;
}): JSX.Element {
  return (
    <p className={cn("text-[10.5px] leading-5 text-content-muted", compact ? "mt-0.5" : "mt-1.5")}>
      <span className="mr-1 text-content-disabled">{frontendMessage(label)}:</span>
      {value}
    </p>
  );
}

export function formatContinuityConfidence(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

export function formatContinuityScalar(value: string | number | boolean): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function formatContinuitySignalValue(valueJson: string): string {
  try {
    const value: unknown = JSON.parse(valueJson);
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return valueJson;
  }
}
