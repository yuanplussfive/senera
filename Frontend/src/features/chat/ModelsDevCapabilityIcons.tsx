import type { ModelsDevModelMetadata } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { AppIcon, type AppIconName, Tooltip } from "../../shared/ui";
import { readModelsDevCapabilityKeys, type ModelsDevCapabilityKey } from "./modelsDevCapabilities";

export interface ModelsDevCapabilityItem {
  label: string;
  icon: AppIconName;
}

export const ModelsDevCapabilityItemByKey: Record<ModelsDevCapabilityKey, ModelsDevCapabilityItem> = {
  toolCalling: { label: frontendMessage("config.model.catalog.tools"), icon: "tools" },
  reasoning: { label: frontendMessage("config.model.catalog.reasoning"), icon: "thinking" },
  structuredOutput: { label: frontendMessage("config.model.catalog.structured"), icon: "code" },
  vision: { label: frontendMessage("config.model.catalog.vision"), icon: "vision" },
  imageOutput: { label: frontendMessage("config.model.catalog.imageOutput"), icon: "image-output" },
  audio: { label: frontendMessage("config.model.catalog.audio"), icon: "file-audio" },
  attachment: { label: frontendMessage("config.model.catalog.attachments"), icon: "paperclip" },
};

export function ModelsDevCapabilityStrip({
  metadata,
  className,
  tooltip = false,
}: {
  metadata?: ModelsDevModelMetadata;
  className?: string;
  tooltip?: boolean;
}): JSX.Element | null {
  const keys = readModelsDevCapabilityKeys(metadata);
  if (keys.length === 0) {
    return null;
  }
  const summary = keys.map((key) => ModelsDevCapabilityItemByKey[key].label).join(" · ");
  const content = (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-sm bg-ink-900/[0.045] px-1.5 text-ink-500",
        className,
      )}
      data-models-dev-capability-summary
      data-capability-count={keys.length}
      role="img"
      aria-label={summary}
    >
      {keys.map((key) => {
        const item = ModelsDevCapabilityItemByKey[key];
        return <AppIcon icon={item.icon} key={key} className="h-3 w-3" aria-hidden={true} />;
      })}
    </span>
  );
  return tooltip ? (
    <Tooltip content={summary} side="top">
      {content}
    </Tooltip>
  ) : (
    content
  );
}
