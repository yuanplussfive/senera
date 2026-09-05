import { FrontendLocales, frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { useFrontendLocale, useSetFrontendLocale } from "../../../i18n/useFrontendLocale";
import { MenuSelect, SettingsControlRow, Switch } from "../../../shared/ui";
import type { SettingsWorkbenchProps } from "../SettingsWorkbenchContracts";
import { SettingsPanel } from "../SettingsPanel";

type MotionLevelOption = { value: "full" | "reduced" | "none"; label: string; description: string };

export function GeneralSettings({
  values,
  motionLevel,
  onValueChange,
  onMotionLevelChange,
}: Pick<SettingsWorkbenchProps, "values" | "motionLevel" | "onValueChange" | "onMotionLevelChange">): JSX.Element {
  const locale = useFrontendLocale();
  const setLocale = useSetFrontendLocale();
  const motionLevelOptions = [
    {
      value: "full",
      label: frontendMessage("settings.general.motionFullLabel"),
      description: frontendMessage("settings.general.motionFullDescription"),
    },
    {
      value: "reduced",
      label: frontendMessage("settings.general.motionReducedLabel"),
      description: frontendMessage("settings.general.motionReducedDescription"),
    },
    {
      value: "none",
      label: frontendMessage("settings.general.motionOffLabel"),
      description: frontendMessage("settings.general.motionOffDescription"),
    },
  ] as const satisfies readonly MotionLevelOption[];
  const interfaceItems = [
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
  ] as const;

  return (
    <div className="space-y-5">
      <SettingsPanel
        title={frontendMessage("settings.general.interfaceTitle")}
        description={frontendMessage("settings.general.layoutDescription")}
      >
        {interfaceItems.map((item) => (
          <SettingsControlRow
            key={item.id}
            label={item.title}
            description={item.description}
            control={
              <Switch
                checked={values[item.id]}
                ariaLabel={item.title}
                onCheckedChange={(checked) => onValueChange(item.id, checked)}
              />
            }
          />
        ))}
      </SettingsPanel>

      <SettingsPanel
        title={frontendMessage("settings.general.languageLabel")}
        description={frontendMessage("settings.general.languageDescription")}
      >
        <SettingsControlRow
          label={frontendMessage("settings.general.languageFieldLabel")}
          control={
            <MenuSelect
              value={locale}
              size="md"
              placeholder={frontendMessage("settings.general.languageFieldLabel")}
              options={[
                { value: FrontendLocales.ZhCn, label: frontendMessage("settings.general.languageZhCn") },
                { value: FrontendLocales.EnUs, label: frontendMessage("settings.general.languageEnUs") },
              ]}
              ariaLabel={frontendMessage("settings.general.languageLabel")}
              onChange={(value) => setLocale(value as typeof locale)}
            />
          }
        />
      </SettingsPanel>

      <SettingsPanel
        title={frontendMessage("settings.general.animationTitle")}
        description={frontendMessage("settings.general.animationDescription")}
      >
        <SettingsControlRow
          label={frontendMessage("settings.general.motionFieldLabel")}
          description={motionLevelOptions.find((option) => option.value === motionLevel)?.description}
          control={
            <MenuSelect
              value={motionLevel}
              size="md"
              placeholder={frontendMessage("settings.general.motionFieldLabel")}
              options={motionLevelOptions}
              ariaLabel={frontendMessage("settings.general.animationTitle")}
              onChange={(value) => onMotionLevelChange(value as typeof motionLevel)}
              renderValue={(_value, option) => <span className="truncate">{option?.label}</span>}
              renderOption={(option) => (
                <span className="flex min-w-0 flex-col py-0.5">
                  <span className="truncate">{option.label}</span>
                  {option.description ? (
                    <span className="mt-0.5 truncate text-[10.5px] leading-4 text-content-muted">
                      {option.description}
                    </span>
                  ) : null}
                </span>
              )}
            />
          }
        />
      </SettingsPanel>
    </div>
  );
}
