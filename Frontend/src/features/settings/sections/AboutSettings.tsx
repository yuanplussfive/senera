import { Check, Copy } from "lucide-react";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { IconButton, useClipboardCopy } from "../../../shared/ui";
import type { SettingsEnvironment } from "../SettingsWorkbenchContracts";
import { SettingsPanel } from "../SettingsPanel";

export function AboutSettings({ environment }: { environment: SettingsEnvironment }): JSX.Element {
  return (
    <div className="space-y-4">
      <SettingsPanel
        title={frontendMessage("settings.about.title")}
        description={frontendMessage("settings.about.description")}
      >
        <dl className="grid gap-x-8 sm:grid-cols-2">
          <AboutValue label={frontendMessage("settings.about.appVersion")} value={environment.appVersion} />
          <AboutValue label={frontendMessage("settings.about.frontendVersion")} value={environment.frontendVersion} />
          <AboutValue
            label={frontendMessage("settings.about.runMode")}
            value={frontendMessage(environment.surface === "desktop" ? "settings.about.desktop" : "settings.about.web")}
          />
          <AboutValue label={frontendMessage("settings.about.buildMode")} value={environment.mode} />
        </dl>
      </SettingsPanel>
      {import.meta.env.DEV ? (
        <details className="border-b border-ink-200/70 pb-3">
          <summary className="cursor-pointer text-[12.5px] font-medium text-ink-700">
            {frontendMessage("settings.about.devDiagnostics")}
          </summary>
          <div className="mt-3 divide-y divide-ink-200/60 border-y border-ink-200/60">
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

function AboutValue({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,auto)] items-baseline gap-3 border-b border-ink-200/60 py-2.5">
      <dt className="truncate text-[11px] text-ink-500">{label}</dt>
      <dd className="max-w-full truncate text-right text-[12.5px] font-medium text-ink-850">{value}</dd>
    </div>
  );
}

function CommandRow({ label, command }: { label: string; command: string }): JSX.Element {
  const { copied, copyText } = useClipboardCopy({ successMessage: frontendMessage("settings.action.copied") });
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5">
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium text-ink-850">{label}</div>
        <code className="mt-0.5 block truncate font-mono text-[11.5px] text-ink-500">{command}</code>
      </div>
      <IconButton
        label={frontendMessage("settings.action.copyCommand")}
        tooltip={copied ? frontendMessage("settings.action.copied") : frontendMessage("settings.action.copyCommand")}
        size="sm"
        tone="muted"
        onClick={() => void copyText(command)}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-accent-content" /> : <Copy className="h-3.5 w-3.5" />}
      </IconButton>
    </div>
  );
}
