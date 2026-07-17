import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { Check, Monitor, Moon, Palette, Pilcrow, Sun, Type } from "lucide-react";
import { cn } from "../../lib/util";
import { useMotionLevel, type MotionLevel } from "../motion";
import {
  accentColors,
  fontScales,
  type AccentColor,
  type AppearanceFontFamily,
  type AppearancePreference,
  type AppearanceSnapshot,
  type ColorScheme,
  type ThemeMode,
} from "./themeModel";
import { colorSchemeGroups } from "./themeData";
import {
  accentColorLabels,
  colorSchemeLabels,
  fontFamilyLabels,
  fontScaleLabels,
  readAccentSwatch,
  readColorSchemeStory,
  readRecommendedAccent,
  readSchemeSwatchStrip,
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
  const recommendedAccent = readRecommendedAccent(preference.colorScheme);

  return (
    <div className={cn("space-y-4", className)}>
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

      <ColorSchemeControl value={preference.colorScheme} onChange={(colorScheme) => setPreference({ colorScheme })} />

      <AccentColorControl
        value={preference.accentColor}
        recommended={recommendedAccent}
        onChange={(accentColor) => setPreference({ accentColor })}
        onUseRecommended={() => setPreference({ accentColor: recommendedAccent })}
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

function ColorSchemeControl({
  value,
  onChange,
}: {
  value: ColorScheme;
  onChange: (value: ColorScheme) => void;
}): JSX.Element {
  return (
    <div>
      <ControlLabel icon={<Palette className="h-3.5 w-3.5" />} label="配色" />
      <div className="space-y-3" role="radiogroup" aria-label="配色">
        {colorSchemeGroups.map((group) => (
          <div key={group.label}>
            <div className="mb-1.5 text-[11px] font-medium text-content-secondary">{group.label}</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {group.items.map((scheme) => {
                const selected = value === scheme;
                const recommended = readRecommendedAccent(scheme);
                return (
                  <button
                    key={scheme}
                    type="button"
                    role="radio"
                    aria-label={`配色：${colorSchemeLabels[scheme]}`}
                    aria-checked={selected}
                    onClick={() => onChange(scheme)}
                    className={cn(
                      "min-w-0 rounded-xl border px-3 py-2.5 text-left transition-[background-color,border-color,box-shadow] duration-150",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
                      selected
                        ? "border-accent-border-strong bg-accent-surface shadow-panel"
                        : "border-line-subtle bg-surface-panel hover:border-line-strong hover:bg-surface-subtle",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-content-primary">
                        {colorSchemeLabels[scheme]}
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-[10.5px] text-content-secondary">
                        <span
                          className="h-2.5 w-2.5 rounded-full border border-line-subtle"
                          style={{ background: readAccentSwatch(recommended) }}
                          aria-hidden="true"
                        />
                        {accentColorLabels[recommended]}
                      </span>
                      {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-accent-content" /> : null}
                    </span>
                    <span className="mt-2 flex gap-1" aria-hidden="true">
                      {readSchemeSwatchStrip(scheme).map((color, index) => (
                        <span
                          key={`${scheme}-${index}`}
                          className="h-3 flex-1 rounded-[4px] border border-black/[0.04]"
                          style={{ background: color }}
                        />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11.5px] leading-5 text-content-secondary">{readColorSchemeStory(value)}</p>
    </div>
  );
}

function AccentColorControl({
  value,
  recommended,
  onChange,
  onUseRecommended,
}: {
  value: AccentColor;
  recommended: AccentColor;
  onChange: (value: AccentColor) => void;
  onUseRecommended: () => void;
}): JSX.Element {
  const usesRecommended = value === recommended;
  return (
    <div>
      <ControlLabel icon={<Check className="h-3.5 w-3.5" />} label="强调色" />
      <div
        className="grid grid-cols-2 gap-1 rounded-lg border border-line-subtle bg-surface-panel p-1 sm:grid-cols-4"
        role="radiogroup"
        aria-label="强调色"
      >
        {accentColors.map((accent) => {
          const selected = value === accent;
          return (
            <button
              key={accent}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(accent)}
              className={cn(
                "inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
                selected
                  ? "bg-surface-subtle text-content-primary shadow-panel"
                  : "text-content-secondary hover:bg-surface-subtle hover:text-content-primary",
              )}
            >
              <span
                className="h-3 w-3 shrink-0 rounded-full border border-line-subtle"
                style={{ background: readAccentSwatch(accent) }}
                aria-hidden="true"
              />
              <span className="truncate">{accentColorLabels[accent]}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex min-h-6 items-center justify-between gap-3 text-[11px] text-content-secondary">
        <span>
          推荐：
          <span className="font-medium text-content-primary">{accentColorLabels[recommended]}</span>
        </span>
        {!usesRecommended ? (
          <button
            type="button"
            onClick={onUseRecommended}
            className="rounded-md px-2 py-1 font-medium text-accent-content transition hover:bg-accent-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
          >
            使用推荐
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 text-accent-content">
            <Check className="h-3 w-3" />
            当前搭配
          </span>
        )}
      </div>
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
  options: Array<{ value: TValue; label: string; icon?: JSX.Element }>;
  value: TValue;
  onChange: (value: TValue) => void;
}): JSX.Element {
  return (
    <div>
      <ControlLabel icon={icon} label={label} />
      <div
        className="grid grid-flow-col auto-cols-fr rounded-lg border border-line-subtle bg-surface-panel p-1"
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
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
                selected
                  ? "bg-surface-subtle text-content-primary shadow-panel"
                  : "text-content-secondary hover:bg-surface-subtle hover:text-content-primary",
              )}
            >
              {option.icon}
              <span className="truncate">{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ControlLabel({ icon, label }: { icon: JSX.Element; label: string }): JSX.Element {
  return (
    <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-content-secondary">
      {icon}
      {label}
    </div>
  );
}
