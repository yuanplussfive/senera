import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { Check, Monitor, Moon, Palette, Pilcrow, Sun, Type } from "lucide-react";
import { cn } from "../../lib/util";
import { useMotionLevel, type MotionLevel } from "../motion";
import {
  accentColors,
  colorSchemes,
  fontScales,
  type AppearanceFontFamily,
  type AppearancePreference,
  type AppearanceSnapshot,
  type ThemeMode,
} from "./themeModel";
import {
  accentColorLabels,
  colorSchemeLabels,
  fontFamilyLabels,
  fontScaleLabels,
  readAccentSwatch,
  readSchemeSwatch,
  themeModeLabels,
} from "./appearancePresentation";
import { createAppearanceStore } from "./themeStore";

const appearanceStore = createAppearanceStore();

export function useAppearance(): AppearanceSnapshot {
  return useSyncExternalStore(
    appearanceStore.subscribe,
    appearanceStore.getSnapshot,
    appearanceStore.getServerSnapshot,
  );
}

export function useSetAppearancePreference(): (preference: Partial<AppearancePreference>) => void {
  return appearanceStore.setPreference;
}

export function AppAppearanceProvider({
  children,
  motionLevel,
}: {
  children: ReactNode;
  motionLevel: MotionLevel;
}): JSX.Element {
  const { prefersReducedMotion } = useMotionLevel();
  useAppearance();

  useEffect(() => {
    appearanceStore.setMotionLevel(motionLevel, prefersReducedMotion);
  }, [motionLevel, prefersReducedMotion]);

  return <>{children}</>;
}

const themeModeOptions = [
  { value: "system", label: themeModeLabels.system, Icon: Monitor },
  { value: "light", label: themeModeLabels.light, Icon: Sun },
  { value: "dark", label: themeModeLabels.dark, Icon: Moon },
] as const satisfies readonly {
  value: ThemeMode;
  label: string;
  Icon: typeof Monitor;
}[];

const fontFamilyOptions = [
  { value: "brand", label: fontFamilyLabels.brand },
  { value: "system", label: fontFamilyLabels.system },
] as const satisfies readonly {
  value: AppearanceFontFamily;
  label: string;
}[];

export function AppearancePreferenceControl({ className }: { className?: string }): JSX.Element {
  const { preference } = useAppearance();
  const setPreference = useSetAppearancePreference();

  return (
    <div className={cn("space-y-3", className)}>
      <SegmentedControl
        label="主题"
        icon={<Palette className="h-3.5 w-3.5" />}
        options={themeModeOptions.map(({ value, label, Icon }) => ({
          value,
          label,
          icon: <Icon className="h-3.5 w-3.5" aria-hidden="true" />,
        }))}
        value={preference.themeMode}
        onChange={(themeMode) => setPreference({ themeMode })}
      />
      <SegmentedControl
        label="配色"
        icon={<Palette className="h-3.5 w-3.5" />}
        options={colorSchemes.map((value) => ({
          value,
          label: colorSchemeLabels[value],
          swatch: readSchemeSwatch(value),
        }))}
        value={preference.colorScheme}
        onChange={(colorScheme) => setPreference({ colorScheme })}
      />
      <SegmentedControl
        label="强调色"
        icon={<Check className="h-3.5 w-3.5" />}
        options={accentColors.map((value) => ({
          value,
          label: accentColorLabels[value],
          swatch: readAccentSwatch(value),
        }))}
        value={preference.accentColor}
        onChange={(accentColor) => setPreference({ accentColor })}
      />
      <SegmentedControl
        label="字体"
        icon={<Type className="h-3.5 w-3.5" />}
        options={fontFamilyOptions.map(({ value, label }) => ({ value, label }))}
        value={preference.fontFamily}
        onChange={(fontFamily) => setPreference({ fontFamily })}
      />
      <SegmentedControl
        label="字号"
        icon={<Pilcrow className="h-3.5 w-3.5" />}
        options={fontScales.map((value) => ({
          value,
          label: fontScaleLabels[value],
        }))}
        value={preference.fontScale}
        onChange={(fontScale) => setPreference({ fontScale })}
      />
    </div>
  );
}

function SegmentedControl<TValue extends string>({
  label,
  icon,
  options,
  value,
  onChange,
}: {
  label: string;
  icon: JSX.Element;
  options: Array<{ value: TValue; label: string; icon?: JSX.Element; swatch?: string }>;
  value: TValue;
  onChange: (value: TValue) => void;
}): JSX.Element {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-ink-600">
        {icon}
        {label}
      </div>
      <div
        className="grid grid-flow-col auto-cols-fr rounded-lg border border-ink-200/70 bg-paper-50 p-1"
        role="radiogroup"
        aria-label={label}
      >
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              className={cn(
                "inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
                selected
                  ? "bg-paper-100 text-ink-900 shadow-panel"
                  : "text-ink-500 hover:bg-paper-100/80 hover:text-ink-850",
              )}
            >
              {option.swatch ? (
                <span
                  className="h-3 w-3 shrink-0 rounded-full border border-ink-200"
                  style={{ background: option.swatch }}
                  aria-hidden="true"
                />
              ) : (
                option.icon
              )}
              <span className="truncate">{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
