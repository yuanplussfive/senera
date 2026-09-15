import { useRef } from "react";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import { cn } from "../lib/util";
import { Skeleton } from "../shared/ui/Skeleton";
import { useInertSiblings } from "../shared/ui/useInertSiblings";

export function ApplicationSurfaceLoading(): JSX.Element {
  return (
    <main
      className="app-loading-shell relative flex h-dvh min-h-[320px] w-screen overflow-hidden bg-surface-canvas text-content-primary"
      role="status"
      aria-busy="true"
      aria-live="polite"
      data-application-loading
    >
      <h1 className="sr-only">Senera</h1>
      <p className="sr-only">{frontendMessage("app.loading")}</p>

      <aside
        className="app-loading-sidebar hidden w-[266px] shrink-0 flex-col border-r border-line-subtle bg-surface-sidebar min-[1024px]:flex"
        aria-hidden="true"
        data-application-loading-sidebar
      >
        <div className="flex h-[var(--senera-top-chrome-height)] shrink-0 items-center gap-2 border-b border-line-subtle px-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="ml-auto h-7 w-7 rounded-lg" />
          <Skeleton className="h-7 w-7 rounded-lg" />
        </div>
        <div className="space-y-3 px-3 py-3">
          <Skeleton className="h-8 w-full rounded-[10px]" />
          <div className="space-y-1.5 pt-1">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className={cn("h-9 rounded-[9px]", index === 0 ? "w-full" : "w-[88%]")} />
            ))}
          </div>
        </div>
        <div className="mt-auto space-y-2 border-t border-line-subtle px-3 py-3">
          <Skeleton className="h-8 w-[74%] rounded-[9px]" />
          <Skeleton className="h-8 w-full rounded-[9px]" />
        </div>
      </aside>

      <section className="relative flex min-w-0 flex-1 flex-col bg-surface-canvas" data-application-loading-main>
        <header className="flex h-[var(--senera-top-chrome-height)] shrink-0 items-center gap-3 border-b border-line-subtle px-3 sm:px-5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-4 w-20" />
          <div className="ml-auto flex items-center gap-2">
            <Skeleton className="h-7 w-7 rounded-lg" />
            <Skeleton className="h-7 w-7 rounded-lg" />
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-hidden" aria-hidden="true" data-application-loading-content>
            <div className="conversation-frame conversation-frame--wide py-10 sm:py-12">
              <div className="w-full space-y-10">
                <div className="ml-auto w-[min(78%,46rem)] space-y-2">
                  <Skeleton className="ml-auto h-10 w-[82%] rounded-[14px]" />
                  <Skeleton className="ml-auto h-3 w-28" />
                </div>
                <div className="w-full max-w-[58rem] space-y-3">
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="h-3 w-[92%]" />
                  <Skeleton className="h-3 w-[76%]" />
                  <Skeleton className="h-3 w-[84%]" />
                </div>
              </div>
            </div>
          </div>

          <div className="shrink-0 bg-transparent pb-4 pt-3 sm:pb-5 sm:pt-3.5" aria-hidden="true">
            <div className="conversation-frame conversation-frame--composer" data-application-loading-composer>
              <div className="flex min-h-[108px] min-w-0 flex-col justify-between gap-4 rounded-[14px] border border-line-subtle bg-surface-raised px-3.5 pb-2.5 pt-[13px] shadow-soft">
                <Skeleton className="h-10 w-[72%] max-w-[520px]" />
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-8 w-8 rounded-lg" />
                    <Skeleton className="h-7 w-24 rounded-lg" />
                  </div>
                  <Skeleton className="h-8 w-8 rounded-full" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <aside
        className="pointer-events-none absolute right-3 top-[calc(var(--senera-top-chrome-height)+var(--senera-top-rail-gap))] hidden w-10 flex-col gap-0.5 rounded-full border border-line-subtle bg-surface-raised p-1 shadow-[0_1px_2px_rgb(var(--color-ink-950)_/_0.05),0_6px_16px_-6px_rgb(var(--color-ink-950)_/_0.12)] min-[1024px]:flex"
        aria-hidden="true"
        data-application-loading-workflow
        data-workflow-dock-loading
      >
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-8 w-8 rounded-full" />
        ))}
      </aside>
    </main>
  );
}

export function SettingsSurfaceLoading({ presentation }: { presentation: "desktop" | "overlay" }): JSX.Element {
  const overlayRef = useRef<HTMLDivElement>(null);
  useInertSiblings(overlayRef, presentation === "overlay");

  const shell = (
    <section
      className={cn(
        "settings-loading-shell relative flex h-full min-h-0 w-full overflow-hidden border border-line-subtle bg-surface-canvas text-content-primary",
        presentation === "overlay" && "rounded-[10px] max-sm:rounded-none max-sm:border-0",
      )}
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label={frontendMessage("settings.loading")}
      data-settings-loading
      data-settings-loading-presentation={presentation}
    >
      <aside className="settings-loading-sidebar w-[224px] shrink-0 flex-col border-r border-line-subtle bg-surface-sidebar">
        <div className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line-subtle px-4">
          <Skeleton className="h-4 w-24" />
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

      <main className="flex min-w-0 flex-1 flex-col bg-surface-subtle">
        <header
          className="settings-loading-header--compact flex h-[var(--senera-top-chrome-height)] shrink-0 items-center gap-3 border-b border-line-subtle bg-surface-panel px-4 sm:px-5"
          data-settings-loading-header="compact"
        >
          <div className="min-w-0 space-y-1">
            <h1 className="sr-only">{frontendMessage("settings.header.title")}</h1>
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-2 w-44 max-w-[45vw]" />
          </div>
        </header>
        <header
          className="settings-loading-header--persistent shrink-0 border-b border-line-subtle bg-surface-canvas px-5 py-4 sm:px-8 sm:py-5"
          data-settings-loading-header="persistent"
        >
          <div className="flex min-w-0 items-start gap-3">
            <Skeleton className="mt-1 h-4 w-4 rounded-sm" />
            <div className="min-w-0">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="mt-1 h-5 w-64 max-w-[70%]" />
            </div>
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
    return <div className="h-dvh min-h-[320px] w-full bg-surface-canvas">{shell}</div>;
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 grid place-items-center bg-[var(--theme-dialog-backdrop)] px-8 py-6 max-sm:p-0"
      role="dialog"
      aria-modal="true"
      aria-busy="true"
      aria-label={frontendMessage("settings.loading")}
      tabIndex={-1}
      data-settings-loading-overlay
    >
      <div className="h-[min(900px,calc(100dvh-48px))] max-h-[calc(100dvh-48px)] w-[min(1440px,calc(100vw-64px))] max-sm:h-dvh max-sm:max-h-dvh max-sm:w-screen">
        {shell}
      </div>
    </div>
  );
}
