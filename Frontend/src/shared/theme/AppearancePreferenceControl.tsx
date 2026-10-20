import { useEffect, useRef, useState } from "react";
import { frontendMessage, type FrontendMessageKey } from "../../i18n/frontendMessageCatalog";
import { useFrontendLocale } from "../../i18n/useFrontendLocale";
import { cn } from "../../lib/util";
import { MenuSelect } from "../ui/MenuSelect";
import { AppIcon, type AppIconName } from "../ui/AppIcon";
import { SettingsControlRow } from "../ui/SettingsControlRow";
import { Slider } from "../ui/Slider";
import {
  appearanceFontFamilies,
  appearanceFontFamilyStacks,
  fontScaleRange,
  fontScales,
  fontScaleValues,
  readFontScaleValue,
  type AppearanceFontFamily,
  type ColorScheme,
  type ThemeMode,
} from "./themeModel";
import {
  colorSchemeLabels,
  fontFamilyDescriptions,
  fontFamilyLabels,
  fontScaleLabels,
  readAccentHex,
  readAccentSwatch,
  readColorSchemeStory,
  readRecommendedAccent,
  readSchemeSwatchStrip,
  themeModeLabels,
} from "./appearancePresentation";
import { colorSchemeGroups } from "./themeData";
import { useAppearance, useFontScalePreview, useSetAppearancePreference } from "./useAppearance";

const themeModeValues = [
  { value: "system", icon: "monitor" },
  { value: "light", icon: "sun" },
  { value: "dark", icon: "moon" },
] as const satisfies readonly { value: ThemeMode; icon: AppIconName }[];

// Keep the appearance controls aligned with the compact selector used for theme mode.
const appearanceControlWidthClass = "w-full sm:max-w-[320px]";

export function AppearancePreferenceControl({ className }: { className?: string }): JSX.Element {
  useFrontendLocale();
  const { preference } = useAppearance();
  const setPreference = useSetAppearancePreference();
  const { previewFontScale, commitFontScale } = useFontScalePreview();

  return (
    <div className={cn("min-w-0", className)}>
      <SettingsControlRow
        label={
          <ControlLabel
            icon={<AppIcon icon="palette" size={14} />}
            label={frontendMessage("appearance.control.theme")}
          />
        }
        description={frontendMessage("settings.appearance.themeDescription")}
        control={
          <ThemeModePicker value={preference.themeMode} onChange={(themeMode) => setPreference({ themeMode })} />
        }
      />

      <section className="border-b border-line-subtle py-4" aria-labelledby="appearance-palette-title">
        <div className="mb-3 min-w-0">
          <h4 id="appearance-palette-title" className="text-[13px] font-medium text-content-primary">
            {frontendMessage("appearance.control.colorScheme")}
          </h4>
          <p className="mt-1 text-[11.5px] leading-5 text-content-secondary">
            {frontendMessage("settings.appearance.paletteHint")}
          </p>
        </div>
        <div className="space-y-4">
          {colorSchemeGroups.map(({ label, items }) => (
            <div key={label}>
              <div className="mb-2 flex items-center gap-2 px-0.5">
                <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-content-muted">
                  {frontendMessage(label as FrontendMessageKey)}
                </span>
                <span className="h-px flex-1 bg-line-subtle" aria-hidden="true" />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {items.map((scheme) => (
                  <ColorSchemeOption
                    key={scheme}
                    scheme={scheme}
                    selected={preference.colorScheme === scheme}
                    onSelect={() => setPreference({ colorScheme: scheme, customAccentColor: undefined })}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <CustomAccentControl
          value={preference.customAccentColor ?? readAccentHex(preference.accentColor)}
          hasCustomValue={Boolean(preference.customAccentColor)}
          onChange={(customAccentColor) => setPreference({ customAccentColor })}
          onClear={() => setPreference({ customAccentColor: undefined })}
        />
      </section>

      <section className="py-4" aria-labelledby="appearance-font-title">
        <div className="mb-3 min-w-0">
          <h4 id="appearance-font-title" className="text-[13px] font-medium text-content-primary">
            {frontendMessage("appearance.control.font")}
          </h4>
          <p className="mt-1 text-[11.5px] leading-5 text-content-secondary">
            {frontendMessage("settings.appearance.fontHint")}
          </p>
        </div>
        <FontFamilyPicker value={preference.fontFamily} onChange={(fontFamily) => setPreference({ fontFamily })} />
        <FontScaleControl
          value={readFontScaleValue(preference)}
          onPreview={previewFontScale}
          onCommit={commitFontScale}
        />
      </section>
    </div>
  );
}

function ControlLabel({ icon, label }: { icon: JSX.Element; label: string }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-content-primary">
      <span className="text-content-muted" aria-hidden="true">
        {icon}
      </span>
      {label}
    </span>
  );
}

function ThemeModePicker({ value, onChange }: { value: ThemeMode; onChange: (value: ThemeMode) => void }): JSX.Element {
  return (
    <div
      className={cn(
        "grid grid-cols-3 gap-1 rounded-full border border-line-subtle bg-surface-muted/60 p-1",
        appearanceControlWidthClass,
      )}
    >
      {themeModeValues.map(({ value: option, icon }) => {
        const selected = value === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={selected}
            aria-label={themeModeLabels[option]}
            className={cn(
              "flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-full px-2 text-[12px] text-content-secondary transition-[background-color,color,box-shadow]",
              selected
                ? "bg-surface-panel font-medium text-content-primary shadow-soft"
                : "hover:bg-surface-hover hover:text-content-primary",
            )}
            onClick={() => onChange(option)}
          >
            <AppIcon icon={icon} size={14} className="shrink-0" aria-hidden="true" />
            <span className="truncate">{themeModeLabels[option]}</span>
          </button>
        );
      })}
    </div>
  );
}

function ColorSchemeOption({
  scheme,
  selected,
  onSelect,
}: {
  scheme: ColorScheme;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  const recommendedAccent = readRecommendedAccent(scheme);
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "group relative flex min-w-0 flex-col gap-2 rounded-[9px] border px-3 py-3 text-left transition-[background-color,border-color,box-shadow]",
        selected
          ? "border-accent-border-strong bg-accent-surface/45 shadow-[inset_0_0_0_1px_var(--accent-border-strong)]"
          : "border-line-subtle bg-surface-panel/55 hover:border-line-strong hover:bg-surface-panel",
      )}
      onClick={onSelect}
    >
      <span className="flex min-w-0 items-start justify-between gap-2">
        <span className="min-w-0 truncate text-[12px] font-medium text-content-primary">
          {colorSchemeLabels[scheme]}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: readAccentSwatch(recommendedAccent) }}
            aria-hidden="true"
          />
          {selected ? <AppIcon icon="checkmark" size={14} className="text-accent-content" aria-hidden="true" /> : null}
        </span>
      </span>
      <span className="flex h-4 w-full overflow-hidden rounded-[4px] border border-line-subtle" aria-hidden="true">
        {readSchemeSwatchStrip(scheme).map((color, index) => (
          <span key={`${scheme}-${index}`} className="min-w-0 flex-1" style={{ background: color }} />
        ))}
      </span>
      <span className="block truncate text-[10px] leading-4 text-content-muted">{readColorSchemeStory(scheme)}</span>
    </button>
  );
}

function CustomAccentControl({
  value,
  hasCustomValue,
  onChange,
  onClear,
}: {
  value: string;
  hasCustomValue: boolean;
  onChange: (value: string) => void;
  onClear: () => void;
}): JSX.Element {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle pt-3">
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-content-primary">
            {frontendMessage("settings.appearance.customAccent")}
          </div>
          <div className="mt-0.5 text-[11px] leading-4 text-content-secondary">
            {frontendMessage("settings.appearance.customAccentDescription")}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <label className="flex h-8 items-center gap-2 rounded-md border border-line bg-surface-panel px-2 text-[11px] text-content-secondary">
          <input
            type="color"
            value={value}
            aria-label={frontendMessage("settings.appearance.customAccent")}
            className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0"
            onChange={(event) => onChange(event.target.value)}
          />
          <span className="font-mono uppercase">{value}</span>
        </label>
        {hasCustomValue ? (
          <button
            type="button"
            className="h-8 rounded-md px-2.5 text-[11px] text-content-secondary transition-colors hover:bg-surface-hover hover:text-content-primary"
            onClick={onClear}
          >
            {frontendMessage("settings.appearance.clearCustomAccent")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function FontFamilyPicker({
  value,
  onChange,
}: {
  value: AppearanceFontFamily;
  onChange: (value: AppearanceFontFamily) => void;
}): JSX.Element {
  const options = appearanceFontFamilies.map((fontFamily) => ({
    value: fontFamily,
    label: fontFamilyLabels[fontFamily],
    description: fontFamilyDescriptions[fontFamily],
  }));
  return (
    <MenuSelect
      value={value}
      options={options}
      placeholder={frontendMessage("appearance.control.font")}
      ariaLabel={frontendMessage("appearance.control.font")}
      size="md"
      triggerClassName={appearanceControlWidthClass}
      renderValue={(_value, option) => (
        <span className="inline-flex min-w-0 items-center gap-3">
          <span
            className="shrink-0 whitespace-nowrap text-[13px] font-medium text-content-primary"
            style={{ fontFamily: appearanceFontFamilyStacks[value] }}
          >
            {frontendMessage("appearance.fontFamilySample")}
          </span>
          <span className="truncate text-[12px] text-content-secondary">{option?.label}</span>
        </span>
      )}
      renderOption={(option) => (
        <span className="flex min-w-0 items-center gap-3">
          <span
            className="w-[78px] shrink-0 whitespace-nowrap text-[13px] font-medium text-content-primary"
            style={{ fontFamily: appearanceFontFamilyStacks[option.value as AppearanceFontFamily] }}
          >
            {frontendMessage("appearance.fontFamilySample")}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[12px] font-medium text-content-primary">{option.label}</span>
            {option.description ? (
              <span className="mt-0.5 block truncate text-[10.5px] leading-4 text-content-muted">
                {option.description}
              </span>
            ) : null}
          </span>
        </span>
      )}
      onChange={(next) => onChange(next as AppearanceFontFamily)}
    />
  );
}

function FontScaleControl({
  value,
  onPreview,
  onCommit,
}: {
  value: number;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
}): JSX.Element {
  const [draftValue, setDraftValue] = useState(value);
  const committedValueRef = useRef(value);

  useEffect(() => {
    setDraftValue(value);
    committedValueRef.current = value;
  }, [value]);

  const marks = fontScales.map((scale) => ({ value: fontScaleValues[scale], label: fontScaleLabels[scale] }));
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium text-content-primary">
          {frontendMessage("appearance.control.fontScale")}
        </span>
        <span className="text-[11.5px] font-medium text-content-secondary">{formatFontScaleValue(draftValue)}</span>
      </div>
      <Slider
        ariaLabel={frontendMessage("appearance.control.fontScale")}
        className={appearanceControlWidthClass}
        value={draftValue}
        min={fontScaleRange.min}
        max={fontScaleRange.max}
        step={fontScaleRange.step}
        marks={marks}
        formatValue={formatFontScaleValue}
        onValueChange={(nextValue) => {
          setDraftValue(nextValue);
          onPreview(nextValue);
        }}
        onValueCommit={(nextValue) => {
          if (committedValueRef.current === nextValue) return;
          committedValueRef.current = nextValue;
          onCommit(nextValue);
        }}
      />
    </div>
  );
}

function formatFontScaleValue(value: number): string {
  return `${Math.round(value * 100)}%`;
}
