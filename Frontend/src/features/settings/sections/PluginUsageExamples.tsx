import type { AgentPluginUsageExample } from "../../../../../Source/AgentSystem/Extensions/AgentPluginUsageExamples";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { resolveFrontendLocalizedText } from "../../../i18n/frontendLocaleModel";
import { useFrontendLocale } from "../../../i18n/useFrontendLocale";

export function PluginUsageExamples({
  examples,
}: {
  examples?: readonly AgentPluginUsageExample[];
}): JSX.Element | null {
  const locale = useFrontendLocale();
  if (!examples?.length) return null;
  return (
    <section className="mb-7" aria-label={frontendMessage("settings.plugins.usageExamples")} data-plugin-usage-examples>
      <h4 className="mb-3 text-[14px] font-semibold text-content-primary">
        {frontendMessage("settings.plugins.usageExamples")}
      </h4>
      <div className="space-y-4">
        {examples.map((example, index) => (
          <div key={index}>
            <h5 className="text-xs font-medium text-content-primary">
              {resolveFrontendLocalizedText(example.title, locale)}
            </h5>
            <blockquote className="my-2 border-l-2 border-line pl-3 text-[13px] leading-6 text-content-primary">
              {resolveFrontendLocalizedText(example.prompt, locale)}
            </blockquote>
            <p className="text-xs leading-6 text-content-secondary">
              {resolveFrontendLocalizedText(example.outcome, locale)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
