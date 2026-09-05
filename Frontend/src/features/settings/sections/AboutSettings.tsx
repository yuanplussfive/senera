import { useEffect } from "react";
import { Check, Copy, Download, ExternalLink, RefreshCw, RotateCw } from "lucide-react";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { cn } from "../../../lib/util";
import { MotionIconSwap } from "../../../shared/motion";
import { Button, IconButton, LogoMark, useClipboardCopy } from "../../../shared/ui";
import type { SettingsEnvironment } from "../SettingsWorkbenchContracts";

export function AboutSettings({ environment }: { environment: SettingsEnvironment }): JSX.Element {
  const update = environment.runtimeUpdate;
  useEffect(() => {
    if (!update || update.snapshot.state !== "idle") return;
    void update.check();
  }, [update]);
  return (
    <div className="space-y-7">
      <section className="border-b border-line-subtle pb-6" data-about-brand>
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-5">
          <div className="flex min-w-0 items-start gap-3.5">
            <LogoMark size={40} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <h2 className="text-[20px] font-semibold leading-6 tracking-[-0.025em] text-content-strong">Senera</h2>
                <span className="font-mono text-[11px] font-medium tabular-nums text-accent-content">
                  v{environment.appVersion}
                </span>
              </div>
              <p className="mt-1.5 max-w-[52ch] text-[12px] leading-5 text-content-secondary">
                {frontendMessage("settings.about.tagline")}
              </p>
            </div>
          </div>
          {update ? <RuntimeUpdateControl update={update} /> : null}
        </div>
      </section>
      <section data-about-environment>
        <div className="mb-4 min-w-0">
          <h3 className="text-[14px] font-semibold leading-5 tracking-[-0.01em] text-content-strong">
            {frontendMessage("settings.about.environment")}
          </h3>
          <p className="mt-1 max-w-[68ch] text-[12px] leading-5 text-content-secondary">
            {frontendMessage("settings.about.environmentDescription")}
          </p>
        </div>
        <dl className="grid border-y border-line-subtle sm:grid-cols-4">
          <AboutValue label={frontendMessage("settings.about.appVersion")} value={environment.appVersion} />
          <AboutValue label={frontendMessage("settings.about.frontendVersion")} value={environment.frontendVersion} />
          <AboutValue
            label={frontendMessage("settings.about.runMode")}
            value={frontendMessage(environment.surface === "desktop" ? "settings.about.desktop" : "settings.about.web")}
          />
          <AboutValue label={frontendMessage("settings.about.buildMode")} value={environment.mode} />
        </dl>
      </section>
      {import.meta.env.DEV ? (
        <details className="border-t border-line-subtle pt-4 pb-1">
          <summary className="cursor-pointer text-[12.5px] font-medium text-content-primary">
            {frontendMessage("settings.about.devDiagnostics")}
          </summary>
          <div className="mt-3 divide-y divide-line-subtle border-y border-line-subtle">
            <CommandRow command="npm run dev.frontend" label={frontendMessage("settings.about.command.frontend")} />
            <CommandRow command="npm run desktop.live" label={frontendMessage("settings.about.command.desktopLive")} />
            <CommandRow
              command="npm run desktop.verify"
              label={frontendMessage("settings.about.command.desktopVerify")}
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function RuntimeUpdateControl({ update }: { update: NonNullable<SettingsEnvironment["runtimeUpdate"]> }): JSX.Element {
  const { snapshot } = update;
  const actionLabel =
    snapshot.action === "download"
      ? frontendMessage("settings.update.download")
      : snapshot.action === "install"
        ? frontendMessage("settings.update.restart")
        : snapshot.action === "reload"
          ? frontendMessage("settings.update.reload")
          : snapshot.action === "operator"
            ? frontendMessage("settings.update.releaseNotes")
            : frontendMessage("settings.update.check");
  const status = updateStatusMessage(snapshot);
  const busy = snapshot.state === "checking" || snapshot.state === "downloading";
  const statusTone =
    snapshot.state === "up-to-date"
      ? "text-moss-600"
      : snapshot.state === "available" || snapshot.state === "downloaded"
        ? "text-accent-content"
        : "text-content-secondary";
  return (
    <div className="flex shrink-0 items-center gap-3.5 max-sm:w-full max-sm:justify-between">
      <div className="min-w-0 text-right max-sm:text-left">
        <div className="text-[11px] leading-4 text-content-muted">{frontendMessage("settings.update.title")}</div>
        <div
          className={cn(
            "mt-0.5 flex items-center justify-end gap-1.5 text-[12px] font-medium max-sm:justify-start",
            statusTone,
          )}
          aria-live="polite"
        >
          <span>
            {status}
            {snapshot.percent !== undefined ? ` · ${Math.round(snapshot.percent)}%` : ""}
          </span>
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        loading={busy}
        onClick={() => void (snapshot.action === "none" ? update.check() : update.apply())}
      >
        {snapshot.action === "download" ? (
          <Download className="h-3.5 w-3.5" />
        ) : snapshot.action === "reload" ? (
          <RefreshCw className="h-3.5 w-3.5" />
        ) : snapshot.action === "operator" ? (
          <ExternalLink className="h-3.5 w-3.5" />
        ) : (
          <RotateCw className="h-3.5 w-3.5" />
        )}
        {actionLabel}
      </Button>
    </div>
  );
}

function updateStatusMessage(update: NonNullable<SettingsEnvironment["runtimeUpdate"]>["snapshot"]): string {
  if (update.state === "available" && update.deployment === "container" && update.availableVersion) {
    return frontendMessage("settings.update.containerAvailable", { version: update.availableVersion });
  }
  if (update.state === "available" && update.availableVersion) {
    return frontendMessage(
      update.deployment === "local" ? "settings.update.localAvailable" : "settings.update.available",
      { version: update.availableVersion },
    );
  }
  if (update.state === "downloaded") return frontendMessage("settings.update.downloaded");
  if (update.state === "downloading") return frontendMessage("settings.update.downloading");
  if (update.state === "checking") return frontendMessage("settings.update.checking");
  if (update.state === "up-to-date") return frontendMessage("settings.update.upToDate");
  if (update.state === "not-configured") return frontendMessage("settings.update.notConfigured");
  if (update.state === "unavailable" || update.state === "error") {
    const errorKey = update.errorCode ? `settings.update.unavailable.${update.errorCode}` : undefined;
    return errorKey && isUpdateErrorMessageKey(errorKey)
      ? frontendMessage(errorKey)
      : frontendMessage("settings.update.unavailable");
  }
  return frontendMessage("settings.update.idle");
}

function isUpdateErrorMessageKey(
  value: string,
): value is
  | "settings.update.unavailable.not_published"
  | "settings.update.unavailable.redirect_rejected"
  | "settings.update.unavailable.invalid_manifest"
  | "settings.update.unavailable.request_failed"
  | "settings.update.unavailable.update_failed" {
  return [
    "settings.update.unavailable.not_published",
    "settings.update.unavailable.redirect_rejected",
    "settings.update.unavailable.invalid_manifest",
    "settings.update.unavailable.request_failed",
    "settings.update.unavailable.update_failed",
  ].includes(value as never);
}

function AboutValue({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="min-w-0 border-b border-line-subtle py-3 sm:border-b-0 sm:border-r sm:px-4 sm:first:pl-0 sm:last:border-r-0 sm:last:pr-0">
      <dt className="truncate text-[11px] text-content-muted">{label}</dt>
      <dd className="mt-1 truncate font-mono text-[12px] font-medium tabular-nums text-content-primary">{value}</dd>
    </div>
  );
}

function CommandRow({ label, command }: { label: string; command: string }): JSX.Element {
  const { copied, copyText } = useClipboardCopy({ successMessage: frontendMessage("settings.action.copied") });
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5">
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium text-content-primary">{label}</div>
        <code className="mt-0.5 block truncate font-mono text-[11.5px] text-content-secondary">{command}</code>
      </div>
      <IconButton
        label={frontendMessage("settings.action.copyCommand")}
        tooltip={copied ? frontendMessage("settings.action.copied") : frontendMessage("settings.action.copyCommand")}
        size="sm"
        tone="muted"
        onClick={() => void copyText(command)}
      >
        <MotionIconSwap stateKey={copied ? "copied" : "copy"}>
          {copied ? <Check className="h-3.5 w-3.5 text-accent-content" /> : <Copy className="h-3.5 w-3.5" />}
        </MotionIconSwap>
      </IconButton>
    </div>
  );
}
