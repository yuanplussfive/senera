import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { AppIcon, Button, MenuSelect } from "../../shared/ui";
import type { ModelThinkingLevel, ModelThinkingProfileConfig } from "../../api/eventTypes";
import { ModelThinkingLevels } from "./modelThinking";
import type { ModelProviderDraft } from "./modelConfigTypes";
import { SectionLabel, SettingRow, SettingsTable } from "./ModelConfigPrimitives";

const thinkingLevelOptions = ModelThinkingLevels.map((level) => ({
  value: level,
  label: level,
}));

export function ModelThinkingControls({
  model,
  disabled,
  reasoningEnabled,
  onChange,
}: {
  model: Pick<ModelProviderDraft, "ThinkingProfiles" | "DefaultThinkingLevel">;
  disabled: boolean;
  reasoningEnabled: boolean;
  onChange: (patch: Partial<ModelProviderDraft>) => void;
}): JSX.Element | null {
  if (!reasoningEnabled) return null;

  const profiles = model.ThinkingProfiles ?? [];
  const availableLevels = ModelThinkingLevels;
  const defaultOptions = [
    { value: "", label: frontendMessage("config.model.thinking.inherit") },
    ...thinkingLevelOptions.filter((option) => availableLevels.includes(option.value)),
  ];

  const updateProfile = (index: number, patch: Partial<ModelThinkingProfileConfig>): void => {
    const nextProfiles = profiles.map((profile, profileIndex) =>
      profileIndex === index ? { ...profile, ...patch } : profile,
    );
    onChange({ ThinkingProfiles: nextProfiles });
  };

  const removeProfile = (index: number): void => {
    const nextProfiles = profiles.filter((_, profileIndex) => profileIndex !== index);
    onChange({ ThinkingProfiles: nextProfiles.length > 0 ? nextProfiles : undefined });
  };

  const addProfile = (): void => {
    const id = `profile-${crypto.randomUUID()}`;
    const level = model.DefaultThinkingLevel ?? profiles[0]?.Level ?? availableLevels[0] ?? "off";
    onChange({
      ThinkingProfiles: [
        ...profiles,
        { Id: id, Label: frontendMessage("config.model.thinking.newProfile"), Level: level },
      ],
    });
  };

  return (
    <div className="mt-3 border-t border-ink-200/75 pt-3" data-model-thinking-controls>
      <SectionLabel
        icon={<AppIcon icon="lightbulb" size={16} />}
        title={frontendMessage("config.model.thinking.title")}
      />
      <p className="mb-3 text-[11px] leading-4 text-ink-500">{frontendMessage("config.model.thinking.description")}</p>

      <SettingsTable>
        <SettingRow
          icon={<AppIcon icon="lightbulb" size={14} />}
          label={frontendMessage("config.model.thinking.default")}
          description={frontendMessage("config.model.thinking.defaultDescription")}
        >
          <MenuSelect
            value={model.DefaultThinkingLevel ?? ""}
            placeholder={frontendMessage("config.model.thinking.inherit")}
            options={defaultOptions}
            disabled={disabled}
            ariaLabel={frontendMessage("config.model.thinking.default")}
            onChange={(value) => onChange({ DefaultThinkingLevel: value ? (value as ModelThinkingLevel) : undefined })}
          />
        </SettingRow>
      </SettingsTable>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12.5px] font-medium text-ink-800">
            {frontendMessage("config.model.thinking.profilesTitle")}
          </div>
          <div className="mt-0.5 text-[11px] leading-4 text-ink-500">
            {frontendMessage("config.model.thinking.profilesDescription")}
          </div>
        </div>
        <Button size="sm" variant="outline" disabled={disabled} onClick={addProfile} className="shrink-0">
          <AppIcon icon="plus" size={14} className="mr-1.5" />
          {frontendMessage("config.model.thinking.addProfile")}
        </Button>
      </div>
      <div className="mt-2 overflow-hidden rounded-md border border-ink-200/65 bg-paper-100/65">
        {profiles.length > 0 ? (
          <div className="divide-y divide-ink-200/70">
            {profiles.map((profile, index) => (
              <div
                key={`${profile.Id}-${index}`}
                className="grid min-w-0 gap-2 bg-paper-50 px-3 py-2.5 sm:grid-cols-[minmax(120px,0.8fr)_minmax(140px,1fr)_140px_32px] sm:items-center"
              >
                <input
                  value={profile.Id}
                  disabled={disabled}
                  aria-label={frontendMessage("config.model.thinking.profileId")}
                  className="h-8 min-w-0 rounded-md border border-ink-200 bg-paper-50 px-2.5 text-[12px] text-ink-800 outline-none focus:border-accent-border focus:ring-2 focus:ring-accent-focus disabled:opacity-55"
                  onChange={(event) => updateProfile(index, { Id: event.currentTarget.value })}
                />
                <input
                  value={profile.Label}
                  disabled={disabled}
                  aria-label={frontendMessage("config.model.thinking.profileLabel")}
                  className="h-8 min-w-0 rounded-md border border-ink-200 bg-paper-50 px-2.5 text-[12px] text-ink-800 outline-none focus:border-accent-border focus:ring-2 focus:ring-accent-focus disabled:opacity-55"
                  onChange={(event) => updateProfile(index, { Label: event.currentTarget.value })}
                />
                <input
                  value={profile.Level}
                  disabled={disabled}
                  aria-label={frontendMessage("config.model.thinking.level")}
                  placeholder={frontendMessage("config.model.thinking.levelPlaceholder")}
                  className="h-8 min-w-0 rounded-md border border-ink-200 bg-paper-50 px-2.5 text-[12px] text-ink-800 outline-none focus:border-accent-border focus:ring-2 focus:ring-accent-focus disabled:opacity-55"
                  onChange={(event) => updateProfile(index, { Level: event.currentTarget.value as ModelThinkingLevel })}
                />
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={frontendMessage("config.model.thinking.removeProfile")}
                  className="grid h-8 w-8 place-items-center rounded-md text-ink-500 transition hover:bg-brick-50 hover:text-brick-600 disabled:pointer-events-none disabled:opacity-45"
                  onClick={() => removeProfile(index)}
                >
                  <AppIcon icon="trash" size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-3 py-3 text-[11px] text-ink-500">
            {frontendMessage("config.model.thinking.noProfiles")}
          </div>
        )}
      </div>
    </div>
  );
}
