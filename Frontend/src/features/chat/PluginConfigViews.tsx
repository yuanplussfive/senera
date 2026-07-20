import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { Code2, Settings2 } from "lucide-react";
import type { TomlTableWithoutBigInt } from "smol-toml";
import type { PluginConfigField, PluginConfigItem, PluginConfigSection } from "../../api/eventTypes";
import { cn } from "../../lib/util";
import { ScrollArea, SwitchTrack } from "../../shared/ui";
import { FieldControl } from "./PluginConfigFields";
import { readDraftValue } from "./pluginConfigDraft";

export type ConfigView = "settings" | "toml";
export type PluginConfigLayoutMode = "panel" | "embedded" | "workspace";

export function ViewSwitch({
  value,
  onChange,
}: {
  value: ConfigView;
  onChange: (value: ConfigView) => void;
}): JSX.Element {
  const items: Array<{ value: ConfigView; label: string; icon: JSX.Element }> = [
    {
      value: "settings",
      label: frontendMessage("runtime.migrated.features.chat.PluginConfigViews.24.33"),
      icon: <Settings2 className="h-3.5 w-3.5" />,
    },
    {
      value: "toml",
      label: frontendMessage("runtime.migrated.features.chat.PluginConfigViews.25.29"),
      icon: <Code2 className="h-3.5 w-3.5" />,
    },
  ];

  return (
    <div className="grid h-8 grid-cols-2 rounded-lg bg-ink-900/[0.055] p-1">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-md px-2 text-[12px] transition",
            value === item.value ? "bg-paper-50 text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-800",
          )}
          aria-pressed={value === item.value}
          onClick={() => onChange(item.value)}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsView({
  plugin,
  sections,
  layoutMode = "panel",
  parsedDraft,
  parseError,
  toolsDisabled,
  onSetToolEnabled,
  onUpdateField,
  onCommit,
}: {
  plugin: PluginConfigItem;
  sections: PluginConfigSection[];
  layoutMode?: PluginConfigLayoutMode;
  parsedDraft?: TomlTableWithoutBigInt;
  parseError?: string;
  toolsDisabled: boolean;
  onSetToolEnabled: (toolName: string, enabled: boolean) => void;
  onUpdateField: (field: PluginConfigField, value: unknown) => void;
  onCommit?: () => void;
}): JSX.Element {
  const content = (
    <div
      onBlurCapture={onCommit}
      className={cn(
        "mx-auto w-full max-w-[820px] min-w-0 px-4 py-5 sm:px-5 sm:py-8",
        layoutMode === "panel" && "min-h-full",
      )}
    >
      {parseError ? (
        <div className="mb-5 rounded-lg border border-brick-100 bg-brick-50 px-3 py-2 text-[12.5px] text-brick-700">
          {frontendMessage("runtime.migrated.features.chat.PluginConfigViews.76.11")}
        </div>
      ) : null}

      {sections.length > 0 ? (
        <div className={cn("space-y-7", parseError && "opacity-60")}>
          <PluginToolsSection
            plugin={plugin}
            disabled={toolsDisabled || Boolean(parseError)}
            onSetToolEnabled={onSetToolEnabled}
          />
          {sections.map((section, sectionIndex) => (
            <SettingsSection
              key={section.name}
              section={section}
              sectionIndex={sectionIndex}
              parsedDraft={parsedDraft}
              disabled={Boolean(parseError)}
              onUpdateField={onUpdateField}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-7">
          <PluginToolsSection
            plugin={plugin}
            disabled={toolsDisabled || Boolean(parseError)}
            onSetToolEnabled={onSetToolEnabled}
          />
          <div className="grid min-h-64 place-items-center rounded-lg border border-ink-200/70 bg-paper-50 text-[13px] text-ink-400 shadow-panel">
            {frontendMessage("runtime.migrated.features.chat.PluginConfigViews.106.13")}
          </div>
        </div>
      )}
    </div>
  );

  if (layoutMode === "embedded") {
    return <div className="bg-paper-50">{content}</div>;
  }

  return (
    <ScrollArea className="min-h-0 flex-1 bg-paper-50" viewportClassName="[&>div]:!block">
      {content}
    </ScrollArea>
  );
}

export function TomlView({
  draft,
  layoutMode = "panel",
  onChange,
  onCommit,
}: {
  draft: string;
  layoutMode?: PluginConfigLayoutMode;
  onChange: (value: string) => void;
  onCommit?: () => void;
}): JSX.Element {
  return (
    <div className="min-h-0 flex-1 bg-paper-50 px-4 py-4 sm:px-5 sm:py-6">
      <textarea
        value={draft}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        className={cn(
          "mx-auto block w-full max-w-[820px] resize-none rounded-lg border border-ink-200 bg-paper-100 p-4",
          layoutMode === "embedded" ? "min-h-[520px]" : "h-full",
          "font-mono text-[12px] leading-5 text-ink-800 shadow-panel outline-none",
          "selection:bg-accent-surface-hover selection:text-ink-900 focus:border-accent-border focus:ring-2 focus:ring-accent-focus",
        )}
      />
    </div>
  );
}

export function Diagnostics({
  diagnostics,
  parseError,
  validationErrors,
  saveError,
}: {
  diagnostics: PluginConfigItem["diagnostics"];
  parseError?: string;
  validationErrors: string[];
  saveError?: string | null;
}): JSX.Element | null {
  const items = [
    ...diagnostics,
    ...(parseError ? [{ severity: "error" as const, message: parseError }] : []),
    ...validationErrors.map((message) => ({ severity: "error" as const, message })),
    ...(saveError ? [{ severity: "error" as const, message: saveError }] : []),
  ];
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 space-y-1">
      {items.map((diagnostic, index) => (
        <div
          key={`${diagnostic.severity}-${index}`}
          className={cn(
            "rounded-md border px-2 py-1.5 text-[12px]",
            diagnostic.severity === "error"
              ? "border-brick-200 bg-brick-50 text-brick-700"
              : "border-ink-200 bg-paper-100 text-umber-600",
          )}
        >
          {diagnostic.message}
        </div>
      ))}
    </div>
  );
}

export function ConfigSourceNotice({ plugin }: { plugin: PluginConfigItem }): JSX.Element | null {
  if (!plugin.needsUserConfig) {
    return null;
  }

  const templateName = plugin.configTemplatePath
    ? plugin.configTemplatePath.split(/[\\/]/).pop()
    : "PluginConfig.example.toml";

  return (
    <div className="mt-2 rounded-md border border-ink-200 bg-paper-100 px-2 py-1.5 text-[12px] leading-5 text-ink-700">
      {plugin.configExists ? (
        <>
          {templateName} {frontendMessage("runtime.migrated.features.chat.PluginConfigViews.205.56")}
        </>
      ) : (
        <>
          {frontendMessage("runtime.migrated.features.chat.PluginConfigViews.205.7")}
          {templateName} {frontendMessage("runtime.migrated.features.chat.PluginConfigViews.205.27")}
        </>
      )}
    </div>
  );
}

function PluginToolsSection({
  plugin,
  disabled,
  onSetToolEnabled,
}: {
  plugin: PluginConfigItem;
  disabled: boolean;
  onSetToolEnabled: (toolName: string, enabled: boolean) => void;
}): JSX.Element | null {
  if (plugin.tools.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold text-ink-900">
            {frontendMessage("runtime.migrated.features.chat.PluginConfigViews.227.66")}
          </h3>
          <p className="mt-0.5 text-[12px] leading-5 text-ink-500">
            {frontendMessage("runtime.migrated.features.chat.PluginConfigViews.229.13")}
          </p>
        </div>
        <span className="pb-0.5 text-[11px] text-ink-400">
          {plugin.enabledToolCount}/{plugin.toolCount}{" "}
          {frontendMessage("runtime.migrated.features.chat.PluginConfigViews.232.104")}
        </span>
      </div>
      <div className="plugin-config-tool-grid divide-y divide-ink-200/70 border-y border-ink-200/70">
        {plugin.tools.map((tool) => (
          <button
            key={tool.name}
            type="button"
            disabled={disabled}
            aria-pressed={tool.enabled}
            className={cn(
              "flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-focus",
              tool.enabled ? "text-ink-900" : "text-ink-600",
              !disabled && "hover:bg-ink-900/[0.035]",
              disabled && "pointer-events-none opacity-55",
            )}
            onClick={() => onSetToolEnabled(tool.name, !tool.enabled)}
          >
            <SwitchTrack checked={tool.enabled} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium">{tool.name}</span>
              {tool.summary ? (
                <span className="mt-0.5 block truncate text-[11px] text-ink-500">{tool.summary}</span>
              ) : null}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function SettingsSection({
  section,
  sectionIndex,
  parsedDraft,
  disabled,
  onUpdateField,
}: {
  section: PluginConfigSection;
  sectionIndex: number;
  parsedDraft?: TomlTableWithoutBigInt;
  disabled: boolean;
  onUpdateField: (field: PluginConfigField, value: unknown) => void;
}): JSX.Element {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold text-ink-900">{sectionDisplayTitle(section, sectionIndex)}</h3>
          {section.description ? (
            <p className="mt-0.5 text-[12px] leading-5 text-ink-500">{section.description}</p>
          ) : null}
        </div>
        <span className="pb-0.5 text-[11px] text-ink-400">
          {section.fields.length} {frontendMessage("runtime.migrated.features.chat.PluginConfigViews.302.83")}
        </span>
      </div>
      <div className="divide-y divide-ink-200/70 border-y border-ink-200/70 bg-paper-50">
        {section.fields.map((field) => (
          <FieldControl
            key={field.path.join(".")}
            field={field}
            value={readDraftValue(parsedDraft, field)}
            disabled={disabled}
            onChange={(value) => onUpdateField(field, value)}
          />
        ))}
      </div>
    </section>
  );
}

function sectionDisplayTitle(section: PluginConfigSection, _sectionIndex: number): string {
  return section.label;
}
