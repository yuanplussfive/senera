import { Tooltip } from "../../shared/ui/Tooltip";
import { useState } from "react";
import { frontendModelConfigMessage } from "../../i18n/frontendModelConfigMessageCatalog";
import { cn } from "../../lib/util";
import { AppIcon } from "../../shared/ui";
import { SettingRow, inputClassName } from "./ModelConfigPrimitives";

/**
 * Mirrors `AgentPortableStaticVisionInputMimeTypes` in
 * Source/AgentSystem/Images/AgentImageNormalizationService.ts. The backend applies it when a
 * model declares no static formats, so an addition must be merged with it or it would silently
 * replace the defaults.
 */
export const PortableStaticVisionFormats: readonly string[] = ["image/jpeg", "image/png", "image/webp"];

export const StaticVisionFormatPresets: readonly string[] = [
  ...PortableStaticVisionFormats,
  "image/gif",
  "image/avif",
  "image/heic",
];

export const AnimatedVisionFormatPresets: readonly string[] = ["image/gif", "image/webp", "image/apng"];

/** File extensions whose registered MIME subtype differs from the extension itself. */
const VisionFormatAliases: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  tif: "image/tiff",
  svg: "image/svg+xml",
};

const VisionFormatPattern = /^image\/[a-z0-9.+-]+$/u;

export function ModelVisionFormatEditor({
  label,
  description,
  emptyHint,
  values,
  baseline,
  presets,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  emptyHint: string;
  values?: readonly string[];
  baseline: readonly string[];
  presets: readonly string[];
  disabled: boolean;
  onChange: (values: string[]) => void;
}): JSX.Element {
  const [draft, setDraft] = useState("");
  const [invalidDraft, setInvalidDraft] = useState(false);
  const declaredValues = values ?? [];
  const isDeclared = declaredValues.length > 0;
  const displayValues = isDeclared ? declaredValues : baseline;
  const addablePresets = presets.filter((preset) => !displayValues.includes(preset));

  const addFormats = (formats: readonly string[]): void => {
    const next = [...displayValues];
    for (const format of formats) {
      if (!next.includes(format)) next.push(format);
    }
    onChange(next);
  };

  const commitDraft = (): void => {
    const { formats, invalid } = parseVisionFormatDraft(draft);
    if (invalid) {
      setInvalidDraft(true);
      return;
    }
    setDraft("");
    setInvalidDraft(false);
    addFormats(formats);
  };

  return (
    <SettingRow label={label} description={description}>
      <div className="w-full min-w-0 space-y-2">
        {displayValues.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {displayValues.map((mime) => {
              const formatLabel = readVisionFormatLabel(mime);
              return (
                <Tooltip content={mime} key={mime}>
                  <span
                    className={cn(
                      "inline-flex h-7 max-w-full items-center gap-1 rounded-md border pl-2 pr-1 text-[11.5px]",
                      isDeclared
                        ? "border-accent-border bg-accent-surface text-accent-content"
                        : "border-dashed border-ink-200/85 bg-paper-100/70 text-ink-600",
                    )}
                  >
                    <span className="truncate">{formatLabel}</span>
                    {isDeclared ? (
                      <button
                        type="button"
                        disabled={disabled}
                        aria-label={frontendModelConfigMessage("config.model.visionInputRemoveFormat", {
                          format: formatLabel,
                        })}
                        className="grid h-5 w-5 shrink-0 place-items-center rounded-sm text-accent-content/70 transition hover:bg-accent-surface-hover hover:text-accent-content disabled:pointer-events-none disabled:opacity-50"
                        onClick={() => onChange(declaredValues.filter((value) => value !== mime))}
                      >
                        <AppIcon icon="close" size={12} />
                      </button>
                    ) : null}
                  </span>
                </Tooltip>
              );
            })}
          </div>
        ) : null}
        {isDeclared ? null : <div className="text-[11px] leading-4 text-ink-500">{emptyHint}</div>}

        <div className="flex min-w-0 items-center gap-1.5">
          <div
            className={cn(
              "flex h-8 min-w-0 flex-1 items-center rounded-md border bg-paper-50",
              invalidDraft ? "border-brick-500" : "border-ink-200",
            )}
          >
            <input
              value={draft}
              disabled={disabled}
              spellCheck={false}
              aria-label={label}
              aria-invalid={invalidDraft || undefined}
              placeholder={frontendModelConfigMessage("config.model.visionInputFormatPlaceholder")}
              className={inputClassName}
              onChange={(event) => {
                setDraft(event.currentTarget.value);
                if (invalidDraft) setInvalidDraft(false);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                event.preventDefault();
                commitDraft();
              }}
            />
          </div>
          <button
            type="button"
            disabled={disabled || draft.trim().length === 0}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-ink-200 bg-paper-50 px-2.5 text-[12px] text-ink-700 transition hover:border-accent-border-strong hover:bg-accent-surface-hover hover:text-accent-content-hover disabled:pointer-events-none disabled:opacity-45"
            onClick={commitDraft}
          >
            <AppIcon icon="plus" size={12} />
            {frontendModelConfigMessage("config.model.visionInputAddFormat")}
          </button>
        </div>

        {invalidDraft ? (
          <div className="text-[11px] leading-4 text-brick-600">
            {frontendModelConfigMessage("config.model.visionInputInvalidFormat")}
          </div>
        ) : null}

        {addablePresets.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-ink-500">
              {frontendModelConfigMessage("config.model.visionInputCommonFormats")}
            </span>
            {addablePresets.map((mime) => (
              <Tooltip content={mime} key={mime}>
                <button
                  type="button"
                  disabled={disabled}

                  className="inline-flex h-6 items-center gap-0.5 rounded-md border border-dashed border-ink-200 px-1.5 text-[11px] text-ink-600 transition hover:border-accent-border hover:bg-accent-surface hover:text-accent-content disabled:pointer-events-none disabled:opacity-50"
                  onClick={() => {
                    setInvalidDraft(false);
                    addFormats([mime]);
                  }}
                >
                  <AppIcon icon="plus" size={10} />
                  {readVisionFormatLabel(mime)}
                </button>
              </Tooltip>
            ))}
          </div>
        ) : null}
      </div>
    </SettingRow>
  );
}

function parseVisionFormatDraft(value: string): { formats: string[]; invalid: boolean } {
  const tokens = value.split(/[,，\s]+/u).filter(Boolean);
  const formats: string[] = [];
  let invalid = tokens.length === 0;
  for (const token of tokens) {
    const format = normalizeVisionFormat(token);
    if (!format) {
      invalid = true;
      continue;
    }
    if (!formats.includes(format)) formats.push(format);
  }
  return { formats, invalid };
}

function normalizeVisionFormat(value: string): string | undefined {
  const token = value.trim().toLowerCase().replace(/^\./u, "");
  if (!token) return undefined;
  const format = VisionFormatAliases[token] ?? (token.includes("/") ? token : `image/${token}`);
  return VisionFormatPattern.test(format) ? format : undefined;
}

function readVisionFormatLabel(mime: string): string {
  const subtype = mime.slice(mime.indexOf("/") + 1);
  return (subtype.split("+")[0] || mime).toUpperCase();
}
