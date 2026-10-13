import type { ReactNode, SVGProps } from "react";
import type { FrontendMessageKey } from "../../i18n/frontendMessageCatalog";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { AppIcon, type AppIconName } from "../../shared/ui";

type ContinuityIcon = AppIconName | ((props: Pick<SVGProps<SVGSVGElement>, "className" | "aria-hidden">) => ReactNode);

export function ContinuityGroup({
  id,
  title,
  summary,
  children,
  icon: Icon,
}: {
  id: "identity" | "recall" | "conditions";
  icon?: ContinuityIcon;
  title: FrontendMessageKey;
  summary?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="border-b border-line-subtle px-5 py-5" data-continuity-group={id}>
      <header className="mb-4 flex min-h-7 items-center gap-2.5 border-b border-line-subtle pb-3">
        {Icon ? <ContinuityIconView icon={Icon} className="h-4 w-4 shrink-0 text-accent-content" /> : null}
        <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold leading-5 text-content-primary">
          {frontendMessage(title)}
        </h3>
        {summary ? (
          <span className="shrink-0 text-[11px] tabular-nums leading-4 text-content-muted">{summary}</span>
        ) : null}
      </header>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

export function ContinuitySubsection({
  title,
  children,
  icon: Icon,
}: {
  icon?: ContinuityIcon;
  title: FrontendMessageKey;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="first:mt-0">
      <div className="mb-2 flex min-h-6 items-center gap-2 text-[12px] font-semibold leading-5 text-content-primary">
        {Icon ? <ContinuityIconView icon={Icon} className="h-3.5 w-3.5 shrink-0 text-umber-500" /> : null}
        <h4 className="min-w-0 flex-1 truncate">{frontendMessage(title)}</h4>
      </div>
      {children}
    </div>
  );
}

export function ContinuityEmptyText({ children }: { children: ReactNode }): JSX.Element {
  return <p className="text-[12px] leading-5 text-content-muted">{children}</p>;
}

function ContinuityIconView({ icon, className }: { icon: ContinuityIcon; className: string }): JSX.Element {
  if (typeof icon === "string") return <AppIcon icon={icon} className={className} aria-hidden="true" />;
  const Icon = icon;
  return <Icon className={className} aria-hidden="true" />;
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
    <p className={cn("text-[12px] leading-5 text-content-secondary", compact ? "mt-0.5" : "mt-1.5")}>
      <span className="mr-1 text-content-muted">{frontendMessage(label)}:</span>
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
