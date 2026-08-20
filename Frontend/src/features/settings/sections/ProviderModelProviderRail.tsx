import { Plus } from "lucide-react";
import { motion } from "framer-motion";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { cn } from "../../../lib/util";
import { motionTimings, useMotionLevel } from "../../../shared/motion";
import { IconButton, ScrollArea } from "../../../shared/ui";
import { inferModelProviderIcon, ModelProviderIcon } from "../../chat/ModelProviderIcon";
import type { ModelProviderDraft } from "../../chat/modelConfigTypes";
import type { ModelServiceState } from "./modelServiceState";

export function ProviderModelProviderRail({
  disabled,
  models,
  onAdd,
  onSelect,
  providers,
  selectedProviderId,
}: {
  disabled: boolean;
  models: readonly ModelProviderDraft[];
  onAdd: () => void;
  onSelect: (providerId: string) => void;
  providers: ModelServiceState["providers"];
  selectedProviderId: string;
}): JSX.Element {
  const { reduceMotion, disableMotion } = useMotionLevel();
  const animateSelection = !reduceMotion && !disableMotion;
  return (
    <section className="flex min-h-0 flex-col overflow-hidden bg-paper-50">
      <div className="flex shrink-0 items-center justify-between border-b border-ink-200/55 px-3 py-3">
        <div>
          <div className="text-[13px] font-semibold text-ink-900">
            {frontendMessage("settings.modelManagement.title")}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-500">
            {frontendMessage("settings.modelManagement.providerHint")}
          </div>
        </div>
        <IconButton
          label={frontendMessage("settings.modelManagement.add")}
          tooltip={frontendMessage("settings.modelManagement.add")}
          size="sm"
          tone="muted"
          disabled={disabled}
          onClick={onAdd}
        >
          <Plus className="h-3.5 w-3.5" />
        </IconButton>
      </div>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full p-2">
        <div className="space-y-1">
          {providers.map((provider) => (
            <button
              key={provider.Id}
              type="button"
              disabled={disabled}
              className={cn(
                "relative grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] disabled:pointer-events-none disabled:opacity-60",
                provider.Id === selectedProviderId
                  ? "text-content-primary"
                  : "text-content-secondary hover:bg-paper-100 hover:text-content-primary",
              )}
              aria-pressed={provider.Id === selectedProviderId}
              onClick={() => onSelect(provider.Id)}
            >
              {provider.Id === selectedProviderId ? (
                <motion.span
                  layoutId={animateSelection ? "settings-model-provider-selection" : undefined}
                  className="absolute inset-0 rounded-md bg-ink-900/[0.055]"
                  transition={animateSelection ? motionTimings.selection : { duration: 0 }}
                  aria-hidden="true"
                />
              ) : null}
              <span className="relative z-[1] grid h-7 w-7 place-items-center rounded-md bg-paper-50/75 shadow-[inset_0_0_0_1px_rgb(110_100_84/0.1)]">
                <ModelProviderIcon icon={provider.Icon || inferModelProviderIcon(provider.Id)} size={17} />
              </span>
              <span className="relative z-[1] min-w-0">
                <span className="block truncate font-medium">
                  {provider.Id || frontendMessage("settings.provider.unnamed")}
                </span>
                <span className="mt-0.5 block text-[10.5px] opacity-70">
                  {frontendMessage("settings.modelManagement.configuredCount", {
                    count: models.filter((model) => model.ProviderId === provider.Id).length,
                  })}
                </span>
              </span>
            </button>
          ))}
        </div>
      </ScrollArea>
    </section>
  );
}
