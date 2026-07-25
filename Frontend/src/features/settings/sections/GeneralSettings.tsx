import { Check } from "lucide-react";
import { FrontendLocales, frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { useFrontendLocale, useSetFrontendLocale } from "../../../i18n/useFrontendLocale";
import { cn } from "../../../lib/util";
import { Switch } from "../../../shared/ui";
import type { SettingsWorkbenchProps } from "../SettingsWorkbenchContracts";
import { SettingsPanel } from "../SettingsPanel";

export function GeneralSettings({
  values,
  motionLevel,
  onValueChange,
  onMotionLevelChange,
}: Pick<SettingsWorkbenchProps, "values" | "motionLevel" | "onValueChange" | "onMotionLevelChange">): JSX.Element {
  const locale = useFrontendLocale();
  const setLocale = useSetFrontendLocale();
  const preferenceSections = [
    {
      id: "layout",
      title: frontendMessage("runtime.migrated.features.session.types.28.12"),
      items: [
        {
          id: "defaultSidebarCollapsed",
          title: frontendMessage("runtime.migrated.features.session.types.32.16"),
          description: frontendMessage("runtime.migrated.features.session.types.33.22"),
        },
        {
          id: "defaultRightPanelCollapsed",
          title: frontendMessage("runtime.migrated.features.session.types.37.16"),
          description: frontendMessage("runtime.migrated.features.session.types.38.22"),
        },
      ],
    },
  ] as const;
  const motionLevelOptions = [
    {
      id: "full",
      title: frontendMessage("runtime.migrated.features.session.types.49.12"),
      description: frontendMessage("runtime.migrated.features.session.types.50.18"),
    },
    {
      id: "reduced",
      title: frontendMessage("runtime.migrated.features.session.types.54.12"),
      description: frontendMessage("runtime.migrated.features.session.types.55.18"),
    },
    {
      id: "none",
      title: frontendMessage("runtime.migrated.features.session.types.59.12"),
      description: frontendMessage("runtime.migrated.features.session.types.60.18"),
    },
  ] as const;

  return (
    <div className="space-y-4">
      {preferenceSections.map((preferenceSection) => (
        <SettingsPanel
          key={preferenceSection.id}
          title={preferenceSection.title}
          description={frontendMessage("settings.general.layoutDescription")}
        >
          <div className="border-y border-ink-200/70 bg-paper-50">
            {preferenceSection.items.map((item, index) => (
              <PreferenceToggle
                key={item.id}
                title={item.title}
                description={item.description}
                checked={values[item.id]}
                separated={index > 0}
                onCheckedChange={(checked) => onValueChange(item.id, checked)}
              />
            ))}
          </div>
        </SettingsPanel>
      ))}
      <SettingsPanel
        title={frontendMessage("settings.general.languageLabel")}
        description={frontendMessage("settings.general.languageDescription")}
      >
        <label className="flex items-center justify-between gap-3 border-y border-ink-200/70 py-3">
          <span className="text-[12.5px] font-medium text-ink-850">
            {frontendMessage("settings.general.languageLabel")}
          </span>
          <select
            aria-label={frontendMessage("settings.general.languageLabel")}
            value={locale}
            onChange={(event) => setLocale(event.target.value as typeof locale)}
            className="h-8 rounded-md border border-line bg-paper-50 px-2 text-[12px] text-ink-800 outline-none focus:border-accent-border focus:ring-2 focus:ring-accent-focus"
          >
            <option value={FrontendLocales.ZhCn}>{frontendMessage("settings.general.languageZhCn")}</option>
            <option value={FrontendLocales.EnUs}>{frontendMessage("settings.general.languageEnUs")}</option>
          </select>
        </label>
      </SettingsPanel>{" "}
      <SettingsPanel
        title={frontendMessage("settings.general.animationTitle")}
        description={frontendMessage("settings.general.animationDescription")}
      >
        <div className="divide-y divide-ink-200/70 border-y border-ink-200/70">
          {motionLevelOptions.map((option) => (
            <MotionLevelOption
              key={option.id}
              title={option.title}
              description={option.description}
              selected={motionLevel === option.id}
              onSelect={() => onMotionLevelChange(option.id)}
            />
          ))}
        </div>
      </SettingsPanel>
    </div>
  );
}

function MotionLevelOption({
  title,
  description,
  selected,
  onSelect,
}: {
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-4 px-3 py-3 text-left transition",
        selected ? "bg-accent-surface text-accent-content" : "text-content-secondary hover:bg-surface-subtle",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-semibold">{title}</span>
        <span className="mt-1 block text-[11.5px] leading-5 text-ink-500">{description}</span>
      </span>
      <span className="grid h-5 w-5 shrink-0 place-items-center text-accent-content" aria-hidden="true">
        {selected ? <Check className="h-3.5 w-3.5" /> : null}
      </span>
    </button>
  );
}

function PreferenceToggle({
  title,
  description,
  checked,
  separated,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  separated: boolean;
  onCheckedChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <div className={cn("flex items-center gap-4 px-4 py-3", separated && "border-t border-ink-200/70")}>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-ink-850">{title}</span>
        <span className="mt-0.5 block text-[11.5px] leading-5 text-ink-500">{description}</span>
      </span>
      <Switch checked={checked} ariaLabel={title} onCheckedChange={onCheckedChange} />
    </div>
  );
}
