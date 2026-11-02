import {
  AgentImageToolsExtensionConfigurationSchema,
  type AgentImageToolsExtensionConfiguration,
} from "../Images/AgentImageToolsConfiguration.js";
import { resolveAgentImageToolInputs, resolveImageRequestTimeout } from "./AgentImageToolInputs.js";
import { AgentImageVisionModelClient } from "../Vision/AgentImageVisionModelClient.js";
import { resolveAgentVisionProvider } from "../Vision/AgentVisionProviderResolver.js";
import type { AgentImageNormalizationService } from "../Images/AgentImageNormalizationService.js";
import { defineSystemTool, systemToolArguments } from "./AgentSystemToolDefinition.js";
import type { AgentResourceSource } from "../Resources/AgentResourceSource.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";

interface ImageAnalyzeArguments extends Record<string, unknown> {
  readonly images: readonly AgentResourceSource[];
  readonly prompt: string;
  readonly timeoutMs?: number;
}

export function createImageAnalyzeSystemTool(
  extensionConfiguration?: Record<string, unknown>,
  conversationModelProviderId?: string,
  dependencies: { readonly imageNormalization?: Pick<AgentImageNormalizationService, "normalize"> } = {},
) {
  const configuration = AgentImageToolsExtensionConfigurationSchema.parse(extensionConfiguration ?? {});
  return defineSystemTool({
    capability: "system.tool.agent-image-tools.ImageAnalyze",
    async execute(arguments_, context) {
      const input = systemToolArguments<ImageAnalyzeArguments>(arguments_);
      const provider = resolveAgentVisionProvider(context.config, {
        conversationModelProviderId,
        configuredModelProviderId: configuration.model.modelProviderId,
      });
      context.deadline?.extendTo?.(resolveImageAnalysisDeadlineMs(provider, input, configuration));
      const images = await resolveAgentImageToolInputs(
        input,
        context,
        configuration,
        provider,
        dependencies.imageNormalization,
      );
      const response = await new AgentImageVisionModelClient().complete({
        requestId: context.requestId,
        provider,
        systemPrompt: configuration.prompt.systemPrompt,
        prompt: input.prompt,
        images: images.map((image) => ({ name: image.name, mime: image.mime, base64: image.base64 })),
        signal: context.signal,
      });
      return {
        images: images.map(({ base64: _base64, ...image }) => image),
        prompt: input.prompt,
        answer: response.text,
        model: response.provider.model,
      };
    },
  });
}

function resolveImageAnalysisDeadlineMs(
  provider: ResolvedAgentModelProviderConfig,
  input: ImageAnalyzeArguments,
  configuration: AgentImageToolsExtensionConfiguration,
): number {
  const modelBudgetMs = Math.max(provider.TimeoutMs, provider.FirstTokenTimeoutMs, provider.MaxRequestMs, 0);
  const remoteImages = input.images.filter((source) => source.kind === "http_url").length;
  const remoteRequestTimeoutMs = resolveImageRequestTimeout(input.timeoutMs, configuration.remote);
  const imageDownloadBudgetMs = remoteImages * remoteRequestTimeoutMs;
  return modelBudgetMs + imageDownloadBudgetMs;
}
