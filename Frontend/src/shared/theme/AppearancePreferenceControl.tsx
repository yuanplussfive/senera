import { Check, Monitor, Moon, Palette, Sun } from "lucide-react";
import { motion } from "framer-motion";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { useFrontendLocale } from "../../i18n/useFrontendLocale";
import { cn } from "../../lib/util";
import { SettingsControlRow } from "../ui/SettingsControlRow";
import { MenuSelect } from "../ui/MenuSelect";
import { motionSprings, useMotionLevel } from "../motion";
import {
  appearanceFontFamilies,
  appearanceFontFamilyStacks,
  colorSchemes,
  fontScaleRange,
  fontScaleValues,
  readFontScaleAnchor,
  readFontScaleValue,
  type AppearanceFontFamily,
  type ColorScheme,
  type FontScale,
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
import { useAppearance, useSetAppearancePreference } from "./useAppearance";

const themeModeValues = [
  { value: "system", Icon: Monitor },
  { value: "light", Icon: Sun },
  { value: "dark", Icon: Moon },
] as const satisfies readonly { value: ThemeMode; Icon: typeof Monitor }[];

// Keep the appearance controls aligned with the compact selector used for theme mode.
const appearanceControlWidthClass = "w-full sm:max-w-[320px]";

export function AppearancePreferenceControl({ className }: { className?: string }): JSX.Element {
  useFrontendLocale();
  const { preference } = useAppearance();
  const setPreference = useSetAppearancePreference();
  const { reduceMotion, disableMotion } = useMotionLevel();
  const animateSelection = !reduceMotion && !disableMotion;

  return (
    <div className={cn("min-w-0", className)}>
      <SettingsControlRow
        label={
          <ControlLabel
            icon={<Palette className="h-3.5 w-3.5" />}
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
        <div className="grid grid-cols-1 divide-y divide-line-subtle border-y border-line-subtle sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-3">
          {colorSchemes.map((scheme) => (
            <ColorSchemeOption
              key={scheme}
              scheme={scheme}
              selected={preference.colorScheme === scheme}
              onSelect={() => setPreference({ colorScheme: scheme, customAccentColor: undefined })}
            />
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
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-[13px] font-medium text-content-primary">
              {frontendMessage("appearance.control.fontScale")}
            </span>
            <span className="text-[11.5px] font-medium text-content-secondary">
              {formatFontScaleValue(readFontScaleValue(preference))}
            </span>
          </div>
          <FontScalePicker
            value={preference.fontScale}
            scaleValue={readFontScaleValue(preference)}
            animateSelection={animateSelection}
            onChange={(scaleValue) =>
              setPreference({ fontScaleValue: scaleValue, fontScale: readFontScaleAnchor(scaleValue) })
            }
          />
        </div>
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
        "grid grid-cols-3 overflow-hidden rounded-md border border-line bg-surface-panel",
        appearanceControlWidthClass,
      )}
    >
      {themeModeValues.map(({ value: option, Icon }) => {
        const selected = value === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={selected}
            aria-label={themeModeLabels[option]}
            className={cn(
              "flex h-9 min-w-0 items-center justify-center gap-1.5 px-2 text-[12px] text-content-secondary transition-colors",
              selected
                ? "bg-accent-surface font-medium text-accent-content"
                : "hover:bg-surface-hover hover:text-content-primary",
            )}
            onClick={() => onChange(option)}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
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
        "group relative flex min-w-0 items-center gap-2.5 px-2.5 py-2.5 text-left transition-colors",
        selected ? "bg-accent-surface/45" : "hover:bg-surface-hover",
      )}
      onClick={onSelect}
    >
      <span
        className="flex h-5 w-14 shrink-0 overflow-hidden rounded-[3px] border border-line-subtle"
        aria-hidden="true"
      >
        {readSchemeSwatchStrip(scheme).map((color, index) => (
          <span key={`${scheme}-${index}`} className="min-w-0 flex-1" style={{ background: color }} />
        ))}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-content-primary">{colorSchemeLabels[scheme]}</span>
        <span className="mt-0.5 block truncate text-[10px] leading-4 text-content-muted">
          {readColorSchemeStory(scheme)}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: readAccentSwatch(recommendedAccent) }}
          aria-hidden="true"
        />
        {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-accent-content" aria-hidden="true" /> : null}
      </span>
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

function FontScalePicker({
  value,
  scaleValue,
  animateSelection,
  onChange,
}: {
  value: FontScale;
  scaleValue: number;
  animateSelection: boolean;
  onChange: (value: number) => void;
}): JSX.Element {
  const scalePercent = ((scaleValue - fontScaleRange.min) / (fontScaleRange.max - fontScaleRange.min)) * 100;
  return (
    <div
      aria-label={frontendMessage("appearance.control.fontScale")}
      className={cn("relative min-w-0 border-y border-line-subtle px-1 py-3", appearanceControlWidthClass)}
    >
      <div
        className="pointer-events-none absolute inset-x-5 top-[19px] h-1 rounded-full bg-line-strong/70"
        aria-hidden="true"
      >
        <motion.span
          className="absolute inset-y-0 left-0 rounded-full bg-accent-solid"
          animate={{ width: `${scalePercent}%` }}
          transition={animateSelection ? motionSprings.signal : { duration: 0 }}
        />
        <motion.span
          className="absolute -top-[6px] h-4 w-4 -translate-x-1/2 rounded-full border-2 border-accent-solid bg-surface-panel shadow-soft"
          animate={{ left: `${scalePercent}%` }}
          transition={animateSelection ? motionSprings.signal : { duration: 0 }}
        />
      </div>
      <input
        type="range"
        min={fontScaleRange.min}
        max={fontScaleRange.max}
        step={fontScaleRange.step}
        value={scaleValue}
        aria-label={frontendMessage("appearance.control.fontScale")}
        className="appearance-font-range relative z-[1] h-8 w-full cursor-pointer bg-transparent opacity-100"
        onInput={(event) => onChange(Number(event.currentTarget.value))}
      />
      <div className="mt-1 grid grid-cols-4 text-[11px] text-content-muted">
        {Object.entries(fontScaleValues).map(([scale]) => (
          <span key={scale} className={cn("text-center", value === scale && "font-medium text-accent-content")}>
            {fontScaleLabels[scale as FontScale]}
          </span>
        ))}
      </div>
    </div>
  );
}

function formatFontScaleValue(value: number): string {
  return `${Math.round(value * 100)}%`;
}
