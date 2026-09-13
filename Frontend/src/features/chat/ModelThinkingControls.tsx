import { LightBulbIcon } from "@heroicons/react/24/outline";
import { Plus, Trash2 } from "lucide-react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { Button, MenuSelect, Switch } from "../../shared/ui";
import type { ModelThinkingLevel, ModelThinkingProfileConfig } from "../../api/eventTypes";
import { ModelThinkingLevelMessageKeys, ModelThinkingLevels } from "./modelThinking";
import type { ModelProviderDraft } from "./modelConfigTypes";
import { SectionLabel, SettingRow, SettingsTable, TextRow } from "./ModelConfigPrimitives";

const thinkingLevelOptions = ModelThinkingLevels.map((level) => ({
  value: level,
  label: frontendMessage(ModelThinkingLevelMessageKeys[level]),
}));

const thinkingDefaultOptions = [
  { value: "", label: frontendMessage("config.model.thinking.inherit") },
  ...thinkingLevelOptions,
];

export function ModelThinkingControls({
  model,
  disabled,
  reasoningEnabled,
  onChange,
}: {
  model: Pick<ModelProviderDraft, "ThinkingLevelMap" | "ThinkingProfiles" | "DefaultThinkingLevel">;
  disabled: boolean;
  reasoningEnabled: boolean;
  onChange: (patch: Partial<ModelProviderDraft>) => void;
}): JSX.Element {
  const profiles = model.ThinkingProfiles ?? [];
  const map = model.ThinkingLevelMap ?? {};
  const availableLevels = ModelThinkingLevels.filter((level) => map[level] !== null);

  const updateMap = (level: ModelThinkingLevel, value: string | null | undefined): void => {
    const next = { ...map };
    if (value === undefined) delete next[level];
    else next[level] = value;
    onChange({ ThinkingLevelMap: Object.keys(next).length > 0 ? next : undefined });
  };

  const updateProfile = (index: number, patch: Partial<ModelThinkingProfileConfig>): void => {
    onChange({
      ThinkingProfiles: profiles.map((profile, profileIndex) =>
        profileIndex === index ? { ...profile, ...patch } : profile,
      ),
    });
  };

  const removeProfile = (index: number): void => {
    const next = profiles.filter((_, profileIndex) => profileIndex !== index);
    onChange({ ThinkingProfiles: next.length > 0 ? next : undefined });
  };

  const addProfile = (): void => {
    const id = `profile-${crypto.randomUUID()}`;
    const level = availableLevels.includes("medium") ? "medium" : (availableLevels[0] ?? "off");
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
        icon={<LightBulbIcon className="h-4 w-4" />}
        title={frontendMessage("config.model.thinking.title")}
      />
      <p className="mb-3 text-[11px] leading-4 text-ink-500">
        {frontendMessage(
          reasoningEnabled ? "config.model.thinking.description" : "config.model.thinking.disabledDescription",
        )}
      </p>

      <SettingsTable>
        <SettingRow
          icon={<LightBulbIcon className="h-3.5 w-3.5" />}
          label={frontendMessage("config.model.thinking.default")}
          description={frontendMessage("config.model.thinking.defaultDescription")}
        >
          <MenuSelect
            value={model.DefaultThinkingLevel ?? ""}
            placeholder={frontendMessage("config.model.thinking.inherit")}
            options={thinkingDefaultOptions.map((option) => ({
              ...option,
              disabled: Boolean(option.value) && !availableLevels.includes(option.value as ModelThinkingLevel),
            }))}
            disabled={disabled || !reasoningEnabled}
            ariaLabel={frontendMessage("config.model.thinking.default")}
            onChange={(value) => onChange({ DefaultThinkingLevel: value ? (value as ModelThinkingLevel) : undefined })}
          />
        </SettingRow>
      </SettingsTable>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12.5px] font-medium text-ink-800">
            {frontendMessage("config.model.thinking.mappingTitle")}
          </div>
          <div className="mt-0.5 text-[11px] leading-4 text-ink-500">
            {frontendMessage("config.model.thinking.mappingDescription")}
          </div>
        </div>
      </div>
      <div
        className={cn(
          "mt-2 overflow-hidden rounded-md border border-ink-200/65 bg-paper-100/65",
          !reasoningEnabled && "opacity-55",
        )}
      >
        <div className="divide-y divide-ink-200/70">
          {ModelThinkingLevels.map((level) => {
            const configured = map[level];
            const enabled = configured !== null;
            return (
              <TextRow
                key={level}
                icon={<span className="text-[11px] font-semibold uppercase text-ink-400">{level}</span>}
                label={frontendMessage(ModelThinkingLevelMessageKeys[level])}
                value={typeof configured === "string" ? configured : ""}
                disabled={disabled || !reasoningEnabled || !enabled}
                placeholder={frontendMessage("config.model.thinking.inherit")}
                onChange={(value) => updateMap(level, value.trim() ? value : undefined)}
                trailing={
                  <Switch
                    checked={enabled}
                    disabled={disabled || !reasoningEnabled}
                    ariaLabel={frontendMessage("config.model.thinking.enableLevel", {
                      level: frontendMessage(ModelThinkingLevelMessageKeys[level]),
                    })}
                    className="mr-1 h-8 w-10 justify-center"
                    onCheckedChange={(checked) => updateMap(level, checked ? undefined : null)}
                  />
                }
              />
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12.5px] font-medium text-ink-800">
            {frontendMessage("config.model.thinking.profilesTitle")}
          </div>
          <div className="mt-0.5 text-[11px] leading-4 text-ink-500">
            {frontendMessage("config.model.thinking.profilesDescription")}
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !reasoningEnabled}
          onClick={addProfile}
          className="shrink-0"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {frontendMessage("config.model.thinking.addProfile")}
        </Button>
      </div>
      <div
        className={cn(
          "mt-2 overflow-hidden rounded-md border border-ink-200/65 bg-paper-100/65",
          !reasoningEnabled && "opacity-55",
        )}
      >
        {profiles.length > 0 ? (
          <div className="divide-y divide-ink-200/70">
            {profiles.map((profile, index) => (
              <div
                key={`${profile.Id}-${index}`}
                className="grid min-w-0 gap-2 bg-paper-50 px-3 py-2.5 sm:grid-cols-[minmax(120px,0.8fr)_minmax(140px,1fr)_140px_32px] sm:items-center"
              >
                <input
                  value={profile.Id}
                  disabled={disabled || !reasoningEnabled}
                  aria-label={frontendMessage("config.model.thinking.profileId")}
                  className="h-8 min-w-0 rounded-md border border-ink-200 bg-paper-50 px-2.5 text-[12px] text-ink-800 outline-none focus:border-accent-border focus:ring-2 focus:ring-accent-focus disabled:opacity-55"
                  onChange={(event) => updateProfile(index, { Id: event.currentTarget.value })}
                />
                <input
                  value={profile.Label}
                  disabled={disabled || !reasoningEnabled}
                  aria-label={frontendMessage("config.model.thinking.profileLabel")}
                  className="h-8 min-w-0 rounded-md border border-ink-200 bg-paper-50 px-2.5 text-[12px] text-ink-800 outline-none focus:border-accent-border focus:ring-2 focus:ring-accent-focus disabled:opacity-55"
                  onChange={(event) => updateProfile(index, { Label: event.currentTarget.value })}
                />
                <MenuSelect
                  value={profile.Level}
                  placeholder={frontendMessage("config.model.thinking.level")}
                  options={thinkingLevelOptions.map((option) => ({
                    ...option,
                    disabled: !availableLevels.includes(option.value as ModelThinkingLevel),
                  }))}
                  disabled={disabled || !reasoningEnabled}
                  ariaLabel={frontendMessage("config.model.thinking.level")}
                  onChange={(value) => updateProfile(index, { Level: value as ModelThinkingLevel })}
                />
                <button
                  type="button"
                  disabled={disabled || !reasoningEnabled}
                  aria-label={frontendMessage("config.model.thinking.removeProfile")}
                  className="grid h-8 w-8 place-items-center rounded-md text-ink-500 transition hover:bg-brick-50 hover:text-brick-600 disabled:pointer-events-none disabled:opacity-45"
                  onClick={() => removeProfile(index)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
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
