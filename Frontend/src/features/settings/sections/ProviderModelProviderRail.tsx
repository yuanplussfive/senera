import { motion } from "framer-motion";
import { useRef } from "react";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { cn } from "../../../lib/util";
import { FluidHoverHighlight, motionTimings, useFluidHover, useMotionLevel } from "../../../shared/motion";
import { AppIcon, IconButton, ScrollArea } from "../../../shared/ui";
import { inferModelProviderEndpointIcon, ModelProviderIcon } from "../../chat/ModelProviderIcon";
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
  const providerListRef = useRef<HTMLDivElement>(null);
  const providerHover = useFluidHover(providerListRef, {
    axis: "y",
    gapClick: false,
    isItemDisabled: (element) => element.hasAttribute("disabled"),
  });
  // Selected provider owns its surface through the layoutId indicator.
  const selectedProviderIndex = providers.findIndex((provider) => provider.Id === selectedProviderId);
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
          <AppIcon icon="plus" size={14} aria-hidden="true" />
        </IconButton>
      </div>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full p-2">
        <div ref={providerListRef} className="relative space-y-1" {...providerHover.handlers}>
          <FluidHoverHighlight
            hover={providerHover}
            hidden={disableMotion || providerHover.activeIndex === selectedProviderIndex}
            className="rounded-md"
          />
          {providers.map((provider, index) => (
            <button
              key={provider.Id}
              type="button"
              ref={providerHover.getItemRef(index)}
              disabled={disabled}
              className={cn(
                "relative z-10 grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] disabled:pointer-events-none disabled:opacity-60",
                provider.Id === selectedProviderId
                  ? "text-content-primary"
                  : cn(
                      "text-content-secondary hover:text-content-primary",
                      disableMotion ? "hover:bg-paper-100" : "hover:bg-transparent",
                    ),
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
              <span className="relative z-[1] grid h-7 w-7 place-items-center">
                <ModelProviderIcon icon={provider.Icon || inferModelProviderEndpointIcon(provider.Id)} size={17} />
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
