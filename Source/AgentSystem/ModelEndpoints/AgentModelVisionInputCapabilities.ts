import {
  AgentPortableStaticVisionInputMimeTypes,
  normalizeImageInputCapabilities,
  type AgentImageInputCapabilities,
} from "../Images/AgentImageNormalizationService.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";

/**
 * Resolves an image request contract from the selected model declaration.
 * Provider identity is intentionally absent: compatible endpoints describe
 * their own limits, while the product owns one portable static-media baseline.
 */
export function resolveAgentModelVisionInputCapabilities(
  provider: Pick<ResolvedAgentModelProviderConfig, "Capabilities">,
): AgentImageInputCapabilities {
  const declared = provider.Capabilities?.VisionInput;
  return normalizeImageInputCapabilities({
    supportedMimeTypes: declared?.SupportedMimeTypes ?? AgentPortableStaticVisionInputMimeTypes,
    ...(declared?.SupportedAnimatedMimeTypes
      ? { supportedAnimatedMimeTypes: declared.SupportedAnimatedMimeTypes }
      : {}),
    ...(declared?.MaxBytes === undefined ? {} : { maxBytes: declared.MaxBytes }),
    ...(declared?.MaxPixels === undefined ? {} : { maxPixels: declared.MaxPixels }),
  });
}
