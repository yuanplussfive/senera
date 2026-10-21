import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { Skeleton } from "../../shared/ui/Skeleton";

export function SettingsSectionLoading({
  variant = "form",
  className,
}: {
  variant?: "form" | "split";
  className?: string;
}): JSX.Element {
  return (
    <div
      className={cn("h-full min-h-[180px] bg-surface-canvas", className)}
      role="status"
      aria-busy="true"
      aria-label={frontendMessage("settings.loading")}
      data-settings-section-loading
      data-settings-section-loading-variant={variant}
    >
      <span className="sr-only">{frontendMessage("settings.loading")}</span>
      {variant === "split" ? <SplitSettingsLoading /> : <FormSettingsLoading />}
    </div>
  );
}

function FormSettingsLoading(): JSX.Element {
  return (
    <div className="mx-auto w-full max-w-[900px] space-y-5 px-5 py-6 sm:px-6">
      <div className="space-y-2" aria-hidden="true">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-2.5 w-64 max-w-[70%]" />
      </div>
      <div className="space-y-3 pt-3" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex items-center justify-between gap-6 border-b border-line-subtle/70 pb-4">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className={cn("h-3", index % 2 === 0 ? "w-40" : "w-52")} />
              <Skeleton className="h-2 w-[65%]" />
            </div>
            <Skeleton className="h-9 w-[min(280px,38%)] rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}

function SplitSettingsLoading(): JSX.Element {
  return (
    <div className="flex h-full min-h-[280px] min-w-0" aria-hidden="true">
      <aside className="hidden w-[32%] min-w-[220px] shrink-0 border-r border-line-subtle bg-surface-subtle p-4 sm:block">
        <div className="mb-4 flex items-center justify-between gap-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-7 w-7 rounded-lg" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className={cn("h-10 rounded-md", index === 0 ? "w-full" : "w-[88%]")} />
          ))}
        </div>
      </aside>
      <main className="min-w-0 flex-1 space-y-5 p-5 sm:p-6">
        <div className="space-y-2">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-2.5 w-72 max-w-[80%]" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="flex items-center justify-between gap-5 border-b border-line-subtle/70 pb-4">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className={cn("h-3", index % 2 === 0 ? "w-36" : "w-48")} />
                <Skeleton className="h-2 w-[62%]" />
              </div>
              <Skeleton className="h-9 w-28 rounded-md" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
