import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { v4 as uuidv4 } from "uuid";
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
    const id = `profile-${uuidv4()}`;
    const level = model.DefaultThinkingLevel ?? profiles[0]?.Level ?? availableLevels[0] ?? "off";
    onChange({
      ThinkingProfiles: [
        ...profiles,
        { Id: id, Label: frontendMessage("config.model.thinking.newProfile"), Level: level },
      ],
    });
  };

  return (
    <section data-model-thinking-controls>
      <SectionLabel
        icon={<AppIcon icon="thinking" size={16} />}
        title={frontendMessage("config.model.thinking.title")}
        description={frontendMessage("config.model.thinking.description")}
      />

      <SettingsTable>
        <SettingRow
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

      <SettingRow
        label={frontendMessage("config.model.thinking.profilesTitle")}
        description={frontendMessage("config.model.thinking.profilesDescription")}
      >
        <Button size="sm" variant="ghost" disabled={disabled} onClick={addProfile} className="shrink-0">
          <AppIcon icon="plus" size={14} className="mr-1.5" />
          {frontendMessage("config.model.thinking.addProfile")}
        </Button>
      </SettingRow>
      <div className="mt-1 overflow-hidden rounded-md border border-line-subtle">
        {profiles.length > 0 ? (
          <div className="divide-y divide-line-subtle/70">
            {profiles.map((profile, index) => (
              <div
                key={`${profile.Id}-${index}`}
                className="grid min-w-0 gap-2 bg-surface-panel px-3 py-2.5 sm:grid-cols-[minmax(120px,0.8fr)_minmax(140px,1fr)_140px_32px] sm:items-center"
              >
                <input
                  value={profile.Id}
                  disabled={disabled}
                  aria-label={frontendMessage("config.model.thinking.profileId")}
                  className="h-8 min-w-0 rounded-md border border-line bg-surface-panel px-2.5 text-[12px] text-content-primary outline-none transition placeholder:text-content-muted disabled:opacity-55"
                  onChange={(event) => updateProfile(index, { Id: event.currentTarget.value })}
                />
                <input
                  value={profile.Label}
                  disabled={disabled}
                  aria-label={frontendMessage("config.model.thinking.profileLabel")}
                  className="h-8 min-w-0 rounded-md border border-line bg-surface-panel px-2.5 text-[12px] text-content-primary outline-none transition placeholder:text-content-muted disabled:opacity-55"
                  onChange={(event) => updateProfile(index, { Label: event.currentTarget.value })}
                />
                <input
                  value={profile.Level}
                  disabled={disabled}
                  aria-label={frontendMessage("config.model.thinking.level")}
                  placeholder={frontendMessage("config.model.thinking.levelPlaceholder")}
                  className="h-8 min-w-0 rounded-md border border-line bg-surface-panel px-2.5 text-[12px] text-content-primary outline-none transition placeholder:text-content-muted disabled:opacity-55"
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
    </section>
  );
}
