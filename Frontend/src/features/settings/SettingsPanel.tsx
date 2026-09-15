import type { ReactNode } from "react";

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
    <section className="border-b border-line-subtle py-5 first:pt-0 last:border-b-0" data-settings-panel>
      <div className="mb-3 min-w-0">
        <h3 className="text-[14px] font-semibold leading-5 tracking-[-0.01em] text-content-strong">{title}</h3>
        <p className="mt-1 max-w-[68ch] text-[12px] leading-5 text-content-secondary">{description}</p>
      </div>
      {children}
    </section>
  );
}
