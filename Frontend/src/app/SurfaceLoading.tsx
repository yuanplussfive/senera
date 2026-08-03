import { LoaderCircle } from "lucide-react";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import { cn } from "../lib/util";

export function ApplicationSurfaceLoading(): JSX.Element {
  return (
    <main
      className="grid min-h-screen place-items-center bg-paper-100 px-4 text-ink-900"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex min-w-[180px] flex-col items-center gap-3">
        <h1 className="text-[18px] font-semibold text-ink-900">Senera</h1>
        <span className="inline-flex items-center gap-2 text-[13px] text-ink-500">
          <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
          {frontendMessage("app.loading")}
        </span>
      </div>
    </main>
  );
}

export function SettingsSurfaceLoading({ presentation }: { presentation: "desktop" | "overlay" }): JSX.Element {
  const shell = (
    <section
      className="flex h-full min-h-0 w-full overflow-hidden border border-ink-200 bg-paper-100 text-ink-900"
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label={frontendMessage("settings.loading")}
      data-settings-loading
      data-settings-loading-presentation={presentation}
    >
      <aside className="hidden w-[220px] shrink-0 border-r border-ink-200/70 bg-paper-50 sm:flex sm:flex-col">
        <div className="flex h-[58px] shrink-0 items-center gap-3 border-b border-ink-200/70 px-4">
          <div className="h-5 w-5 bg-ink-900/[0.08] motion-safe:animate-pulse" />
          <div className="h-3 w-24 bg-ink-900/[0.08] motion-safe:animate-pulse" />
        </div>
        <div className="space-y-3 px-3 py-4" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => (
            <div
              key={index}
              className={cn(
                "h-8 bg-ink-900/[0.055] motion-safe:animate-pulse",
                index === 0 ? "w-full" : index % 2 === 0 ? "w-[82%]" : "w-[91%]",
              )}
            />
          ))}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[58px] shrink-0 items-center gap-3 border-b border-ink-200/70 bg-paper-50 px-4 sm:px-5">
          <div className="h-5 w-5 bg-ink-900/[0.08] motion-safe:animate-pulse" aria-hidden="true" />
          <div className="min-w-0 space-y-1">
            <h1 className="text-[14px] font-semibold leading-5 text-ink-900">
              {frontendMessage("settings.header.title")}
            </h1>
            <div className="h-2 w-44 max-w-[45vw] bg-ink-900/[0.055] motion-safe:animate-pulse" aria-hidden="true" />
          </div>
        </header>
        <div className="flex min-h-0 flex-1 items-center justify-center px-5 py-8">
          <span className="inline-flex items-center gap-2 text-[12.5px] text-ink-450">
            <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
            {frontendMessage("settings.loading")}
          </span>
        </div>
      </main>
    </section>
  );

  if (presentation === "desktop") {
    return <div className="h-dvh min-h-[320px] w-full bg-paper-100">{shell}</div>;
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/25 px-8 py-6 max-sm:p-0">
      <div className="h-[min(900px,calc(100dvh-48px))] min-h-[320px] w-[min(1440px,calc(100vw-64px))] max-sm:h-dvh max-sm:w-screen">
        {shell}
      </div>
    </div>
  );
}
