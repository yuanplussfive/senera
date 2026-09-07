import type { ElementType } from "react";
import CodeBracketIcon from "@heroicons/react/24/outline/CodeBracketIcon";
import EyeIcon from "@heroicons/react/24/outline/EyeIcon";
import LightBulbIcon from "@heroicons/react/24/outline/LightBulbIcon";
import PaperClipIcon from "@heroicons/react/24/outline/PaperClipIcon";
import PhotoIcon from "@heroicons/react/24/outline/PhotoIcon";
import SpeakerWaveIcon from "@heroicons/react/24/outline/SpeakerWaveIcon";
import WrenchScrewdriverIcon from "@heroicons/react/24/outline/WrenchScrewdriverIcon";
import type { ModelsDevModelMetadata } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { Tooltip } from "../../shared/ui";
import { readModelsDevCapabilityKeys, type ModelsDevCapabilityKey } from "./modelsDevCapabilities";

interface ModelsDevCapabilityItem {
  label: string;
  Icon: ElementType<{ className?: string; "aria-hidden"?: boolean }>;
}

const ModelsDevCapabilityItemByKey: Record<ModelsDevCapabilityKey, ModelsDevCapabilityItem> = {
  toolCalling: { label: frontendMessage("config.model.catalog.tools"), Icon: WrenchScrewdriverIcon },
  reasoning: { label: frontendMessage("config.model.catalog.reasoning"), Icon: LightBulbIcon },
  structuredOutput: { label: frontendMessage("config.model.catalog.structured"), Icon: CodeBracketIcon },
  vision: { label: frontendMessage("config.model.catalog.vision"), Icon: EyeIcon },
  imageOutput: { label: frontendMessage("config.model.catalog.imageOutput"), Icon: PhotoIcon },
  audio: { label: frontendMessage("config.model.catalog.audio"), Icon: SpeakerWaveIcon },
  attachment: { label: frontendMessage("config.model.catalog.attachments"), Icon: PaperClipIcon },
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
        return <item.Icon key={key} className="h-3 w-3" aria-hidden={true} />;
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
