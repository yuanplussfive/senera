import { useMemo } from "react";
import { RotateCcw } from "lucide-react";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import {
  AppearancePreferenceControl,
  createAppearanceSummary,
  defaultAppearancePreference,
  isDefaultAppearancePreference,
  readAccentSwatch,
  readSchemeSwatch,
  useAppearance,
  useSetAppearancePreference,
  type AppearancePreference,
  type AppearanceSummaryItem,
  type ResolvedTheme,
} from "../../../shared/theme";
import { Button, MetaLabel } from "../../../shared/ui";
import { SettingsPanel } from "../SettingsPanel";

export function AppearanceSettings(): JSX.Element {
  const { preference, resolvedTheme } = useAppearance();
  const setAppearancePreference = useSetAppearancePreference();
  const summary = useMemo(() => createAppearanceSummary(preference), [preference]);
  const usesDefault = isDefaultAppearancePreference(preference);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,540px)_minmax(0,1fr)]">
        <SettingsPanel
          title={frontendMessage("settings.appearance.title")}
          description={frontendMessage("settings.appearance.description")}
        >
          <AppearancePreferenceControl />
          <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-ink-200/60 pt-3">
            <Button
              variant="outline"
              size="sm"
              disabled={usesDefault}
              onClick={() => setAppearancePreference(defaultAppearancePreference)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {frontendMessage("settings.appearance.reset")}
            </Button>
          </div>
        </SettingsPanel>
        <SettingsPanel
          title={frontendMessage("settings.appearance.previewTitle")}
          description={frontendMessage("settings.appearance.previewDescription")}
        >
          <AppearancePreview preference={preference} resolvedTheme={resolvedTheme} summary={summary} />
        </SettingsPanel>
      </div>
    </div>
  );
}

function AppearancePreview({
  preference,
  resolvedTheme,
  summary,
}: {
  preference: AppearancePreference;
  resolvedTheme: ResolvedTheme;
  summary: AppearanceSummaryItem[];
}): JSX.Element {
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {summary.map((item) => (
          <div key={item.id} className="min-w-0">
            <dt className="text-[11px] text-content-secondary">{item.label}</dt>
            <dd className="mt-0.5 truncate text-[13px] font-medium text-ink-900">{item.value}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-ink-200/60 pt-4">
        <div className="flex items-center justify-between gap-3">
          <MetaLabel size="sm">{frontendMessage("settings.appearance.previewLabel")}</MetaLabel>
          <span className="text-[11px] font-medium text-content-secondary">
            {resolvedTheme === "dark"
              ? frontendMessage("settings.appearance.dark")
              : frontendMessage("settings.appearance.light")}
          </span>
        </div>
        <div
          className="mt-3 overflow-hidden rounded-lg border border-line-subtle bg-[var(--theme-bg)] p-2"
          aria-label={frontendMessage("settings.appearance.previewAria")}
        >
          <div className="grid min-h-[220px] grid-cols-[104px_minmax(0,1fr)] gap-2">
            <div className="flex flex-col rounded-lg border border-line-subtle bg-[var(--theme-sidebar-bg)] p-2 shadow-panel">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-content-primary">
                <span
                  className="h-4 w-4 rounded-[5px] border border-line-subtle"
                  style={{ background: readSchemeSwatch(preference.colorScheme) }}
                />
                Senera
              </div>
              <div className="mt-2 h-5 rounded-md border border-line-subtle bg-surface-raised" />
              <div className="mt-2 space-y-1">
                <div className="rounded-md bg-accent-surface px-2 py-1.5 text-[9px] font-medium text-accent-content">
                  {frontendMessage("settings.appearance.sampleTitle")}
                </div>
                <div className="px-2 py-1.5 text-[9px] text-content-secondary">
                  {frontendMessage("settings.appearance.sampleNewChat")}
                </div>
                <div className="px-2 py-1.5 text-[9px] text-content-secondary">
                  {frontendMessage("settings.appearance.sampleDiscussion")}
                </div>
              </div>
              <div className="mt-auto flex items-center gap-1.5 border-t border-line-subtle pt-2">
                <span className="h-4 w-4 rounded-full bg-surface-muted" />
                <span className="text-[9px] text-content-secondary">Hira</span>
              </div>
            </div>
            <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line-subtle bg-[var(--theme-bg)]">
              <div className="flex h-8 items-center border-b border-line-subtle bg-surface-raised px-2.5 text-[10px] font-semibold text-content-primary">
                {frontendMessage("settings.appearance.sampleTitle")}
              </div>
              <div className="flex flex-1 flex-col gap-2.5 p-3">
                <div className="ml-auto max-w-[80%] rounded-lg rounded-tr-sm bg-[var(--theme-chat-user-bg)] px-2.5 py-1.5 text-[9.5px] leading-4 text-[var(--theme-chat-user-fg)]">
                  {frontendMessage("settings.appearance.samplePrompt")}
                </div>
                <div>
                  <div className="text-[9px] font-semibold text-content-primary">Senera</div>
                  <div className="mt-1 text-[9.5px] leading-4 text-content-secondary">
                    {frontendMessage("settings.appearance.sampleResponse")}
                  </div>
                  <div className="mt-2 overflow-hidden rounded-md border border-line-subtle bg-[var(--theme-code-editor-bg)]">
                    <div className="border-b border-line-subtle bg-[var(--theme-code-editor-gutter-bg)] px-2 py-1 font-mono text-[8px] text-[var(--theme-code-editor-gutter-fg)]">
                      theme.ts
                    </div>
                    <div className="px-2 py-1.5 font-mono text-[8px] text-[var(--theme-code-editor-fg)]">
                      const theme = &quot;ready&quot;;
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-2.5 pt-0">
                <div className="flex items-center gap-2 rounded-lg border border-line bg-[var(--theme-chat-composer-bg)] px-2.5 py-2 shadow-[var(--shadow-soft)]">
                  <span className="min-w-0 flex-1 text-[9px] text-content-secondary">
                    {frontendMessage("settings.appearance.sampleComposer")}
                  </span>
                  <span
                    className="h-5 w-5 rounded-full"
                    style={{ background: readAccentSwatch(preference.accentColor) }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
