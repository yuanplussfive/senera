import { Plus } from "lucide-react";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { cn } from "../../../lib/util";
import { Button, ScrollArea } from "../../../shared/ui";
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
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-ink-200/70 bg-paper-50">
      <div className="flex shrink-0 items-center justify-between border-b border-ink-200/70 px-3 py-3">
        <div>
          <div className="text-[13px] font-semibold text-ink-900">
            {frontendMessage("settings.modelManagement.title")}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-500">
            {frontendMessage("settings.modelManagement.providerHint")}
          </div>
        </div>
        <Button size="sm" variant="outline" disabled={disabled} onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" />
          {frontendMessage("settings.modelManagement.add")}
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full p-2">
        <div className="space-y-1">
          {providers.map((provider) => (
            <button
              key={provider.Id}
              type="button"
              disabled={disabled}
              className={cn(
                "w-full rounded-md border px-2.5 py-2 text-left text-[12px] disabled:pointer-events-none disabled:opacity-60",
                provider.Id === selectedProviderId
                  ? "border-accent-border bg-accent-surface text-accent-content"
                  : "border-transparent hover:border-ink-200 hover:bg-paper-100",
              )}
              aria-pressed={provider.Id === selectedProviderId}
              onClick={() => onSelect(provider.Id)}
            >
              <span className="block truncate font-medium">
                {provider.Id || frontendMessage("settings.provider.unnamed")}
              </span>
              <span className="mt-0.5 block text-[10.5px] opacity-70">
                {frontendMessage("settings.modelManagement.configuredCount", {
                  count: models.filter((model) => model.ProviderId === provider.Id).length,
                })}
              </span>
            </button>
          ))}
        </div>
      </ScrollArea>
    </section>
  );
}
