import type { FrontendLocalizedText } from "../../../i18n/frontendLocaleModel";
import { resolveFrontendLocalizedText } from "../../../i18n/frontendLocaleModel";
import { useFrontendLocale } from "../../../i18n/useFrontendLocale";
import { LazyMarkdownRenderer } from "../../../shared/code/LazyMarkdownRenderer";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { AppIcon } from "../../../shared/ui";

/** Authors control the content and structure; the product supplies typography. */
export function PluginDocumentation({
  content,
  summary,
}: {
  content?: FrontendLocalizedText | string;
  summary?: string;
}): JSX.Element | null {
  const locale = useFrontendLocale();
  if (!content) return null;
  const markdown = typeof content === "string" ? content : resolveFrontendLocalizedText(content, locale);
  const body = (
    <LazyMarkdownRenderer
      className="text-[13px] leading-7 text-content-secondary"
      lightweightCode
      externalLinkPresentation="text"
    >
      {markdown}
    </LazyMarkdownRenderer>
  );
  if (summary)
    return (
      <details className="group/guide mb-5">
        <summary className="flex cursor-pointer list-none items-start gap-3 text-xs leading-6 text-content-secondary outline-none focus-visible:ring-2 focus-visible:ring-accent-focus [&::-webkit-details-marker]:hidden">
          <span className="line-clamp-2 flex-1 group-open/guide:line-clamp-none">{summary}</span>
          <span className="flex shrink-0 items-center gap-1 text-content-muted">
            {frontendMessage("settings.plugins.readGuide")}
            <AppIcon icon="chevron-down" size={13} className="group-open/guide:rotate-180" />
          </span>
        </summary>
        <div className="mt-4">{body}</div>
      </details>
    );
  return <div className="mb-7">{body}</div>;
}
