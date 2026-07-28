import { FrontendLocales, frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { useFrontendLocale, useSetFrontendLocale } from "../../../i18n/useFrontendLocale";
import { Switch } from "../../../shared/ui";
import type { SettingsWorkbenchProps } from "../SettingsWorkbenchContracts";
import { SettingsPanel } from "../SettingsPanel";

export function GeneralSettings({
  values,
  onValueChange,
}: Pick<SettingsWorkbenchProps, "values" | "onValueChange">): JSX.Element {
  const locale = useFrontendLocale();
  const setLocale = useSetFrontendLocale();
  const preferenceSections = [
    {
      id: "layout",
      title: frontendMessage("settings.general.interfaceTitle"),
      items: [
        {
          id: "defaultSidebarCollapsed",
          title: frontendMessage("settings.general.sidebarCollapsedLabel"),
          description: frontendMessage("settings.general.sidebarCollapsedDescription"),
        },
        {
          id: "defaultRightPanelCollapsed",
          title: frontendMessage("settings.general.thinkingCollapsedLabel"),
          description: frontendMessage("settings.general.thinkingCollapsedDescription"),
        },
      ],
    },
  ] as const;
  return (
    <div className="space-y-4">
      {preferenceSections.map((preferenceSection) => (
        <SettingsPanel key={preferenceSection.id} title={preferenceSection.title}>
          <div className="space-y-1">
            {preferenceSection.items.map((item) => (
              <PreferenceToggle
                key={item.id}
                title={item.title}
                description={item.description}
                checked={values[item.id]}
                onCheckedChange={(checked) => onValueChange(item.id, checked)}
              />
            ))}
          </div>
        </SettingsPanel>
      ))}
      <SettingsPanel title={frontendMessage("settings.general.languageLabel")}>
        <select
          aria-label={frontendMessage("settings.general.languageLabel")}
          value={locale}
          onChange={(event) => setLocale(event.target.value as typeof locale)}
          className="h-9 w-full max-w-64 rounded-md border border-line bg-paper-50 px-2.5 text-[12.5px] text-ink-800 outline-none focus:border-accent-border focus:ring-2 focus:ring-accent-focus"
        >
          <option value={FrontendLocales.ZhCn}>{frontendMessage("settings.general.languageZhCn")}</option>
          <option value={FrontendLocales.EnUs}>{frontendMessage("settings.general.languageEnUs")}</option>
        </select>
      </SettingsPanel>
    </div>
  );
}

function PreferenceToggle({
  title,
  description,
  checked,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-4 rounded-md px-3 py-3">
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-ink-850">{title}</span>
        <span className="mt-0.5 block text-[11.5px] leading-5 text-ink-500">{description}</span>
      </span>
      <Switch checked={checked} ariaLabel={title} onCheckedChange={onCheckedChange} />
    </div>
  );
}
