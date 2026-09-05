import { frontendMessage } from "../i18n/frontendMessageCatalog";
import { cn } from "../lib/util";
import { LoadingSignal } from "../shared/ui/LoadingSignal";
import { Skeleton } from "../shared/ui/Skeleton";

export function ApplicationSurfaceLoading(): JSX.Element {
  return (
    <main
      className="grid min-h-screen place-items-center bg-paper-100 px-4 text-ink-900"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex min-w-[220px] flex-col items-center gap-3">
        <LoadingSignal size="lg" />
        <h1 className="sr-only">Senera</h1>
        <span className="text-[12.5px] text-content-secondary">{frontendMessage("app.loading")}</span>
      </div>
    </main>
  );
}

export function SettingsSurfaceLoading({ presentation }: { presentation: "desktop" | "overlay" }): JSX.Element {
  const shell = (
    <section
      className={cn(
        "relative flex h-full min-h-0 w-full overflow-hidden border border-ink-200/70 bg-paper-50 text-ink-900",
        presentation === "overlay" && "rounded-[10px]",
      )}
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label={frontendMessage("settings.loading")}
      data-settings-loading
      data-settings-loading-presentation={presentation}
    >
      <span className="senera-loading-rail absolute inset-x-0 top-0 z-10" aria-hidden="true" />
      <aside className="hidden w-[240px] shrink-0 border-r border-ink-200/55 bg-paper-100/55 sm:flex sm:flex-col">
        <div className="flex h-[52px] shrink-0 items-center gap-3 px-4">
          <Skeleton className="h-3 w-20" />
        </div>
        <div className="space-y-3 px-3 py-4" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => (
            <div
              key={index}
              className={cn("h-8 rounded-md", index === 0 ? "w-full" : index % 2 === 0 ? "w-[82%]" : "w-[91%]")}
            >
              <Skeleton className="h-full w-full rounded-md" />
            </div>
          ))}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-ink-200/55 bg-paper-50 px-4 sm:px-5">
          <LoadingSignal size="sm" className="gap-0" />
          <div className="min-w-0 space-y-1">
            <h1 className="sr-only">{frontendMessage("settings.header.title")}</h1>
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-2 w-44 max-w-[45vw]" />
          </div>
        </header>
        <div className="flex min-h-0 flex-1 items-start justify-center px-5 py-8 sm:px-8">
          <div className="w-full max-w-[760px] space-y-5" aria-hidden="true">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-2.5 w-64 max-w-[70%]" />
            <div className="space-y-3 pt-3">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="flex items-center justify-between gap-6 border-b border-ink-200/40 pb-4">
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className={cn("h-3", index % 2 === 0 ? "w-40" : "w-52")} />
                    <Skeleton className="h-2 w-[65%]" />
                  </div>
                  <Skeleton className="h-9 w-[min(280px,38%)] rounded-md" />
                </div>
              ))}
            </div>
          </div>
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
