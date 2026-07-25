import type { ReactNode } from "react";
import { MetaLabel } from "../../shared/ui";

export function SettingsPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="border-b border-ink-200/70 pb-4 last:border-b-0">
      <div className="pb-2">
        <MetaLabel as="h3" size="sm">
          {title}
        </MetaLabel>
        <p className="mt-1 text-[12px] leading-5 text-ink-500">{description}</p>
      </div>
      {children}
    </section>
  );
}
