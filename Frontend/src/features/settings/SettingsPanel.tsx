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
    <section className="border-b border-ink-200/60 py-5 first:pt-0 last:border-b-0 last:pb-0" data-settings-panel>
      <div className="pb-3">
        <h3 className="text-[14px] font-semibold leading-5 tracking-[-0.01em] text-ink-900">{title}</h3>
        <p className="mt-1 max-w-[68ch] text-[12px] leading-6 text-ink-500">{description}</p>
      </div>
      {children}
    </section>
  );
}
