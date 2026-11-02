import { Tooltip } from "../../shared/ui/Tooltip";
import { forwardRef } from "react";
import { useActiveOptionScroll } from "../../shared/selection/useActiveOptionScroll";
import type {
  AgentActivationCatalogEntry,
  AgentActivationCatalogSnapshot,
  AgentActivationKind,
  ExplicitActivationReference,
} from "../../api/eventTypes";
import { frontendChatMessage } from "../../i18n/frontendChatMessageCatalog";
import { resolveFrontendLocalizedText, type FrontendLocale } from "../../i18n/frontendLocaleModel";
import { cn } from "../../lib/util";
import { AppIcon, ScrollArea, isAppIconName, type AppIconName } from "../../shared/ui";
import {
  AgentToolPresentationIcon,
  isAgentToolPresentationIcon,
} from "../../shared/workspace/AgentToolPresentationIcon";
import type { AgentToolPresentationIcon as AgentToolPresentationIconName } from "../../../../Source/AgentSystem/Types/AgentToolPresentationTypes";

const activationKindPresentation: Record<
  AgentActivationKind,
  {
    readonly icon: AppIconName;
    readonly label:
      | "chat.composer.activation.skill"
      | "chat.composer.activation.plugin"
      | "chat.composer.activation.mcp"
      | "chat.composer.activation.system";
  }
> = {
  skill: { icon: "book-open", label: "chat.composer.activation.skill" },
  system: { icon: "tools", label: "chat.composer.activation.system" },
  plugin: { icon: "package", label: "chat.composer.activation.plugin" },
  mcp: { icon: "server", label: "chat.composer.activation.mcp" },
};

const activationKindOrder: readonly AgentActivationKind[] = ["skill", "system", "plugin", "mcp"];

export function rankActivationCandidates(
  entries: readonly AgentActivationCatalogEntry[],
  query: string,
  locale: FrontendLocale,
): AgentActivationCatalogEntry[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return entries
    .filter((entry) => {
      if (!normalizedQuery) return true;
      return [
        entry.id,
        entry.title,
        entry.description,
        entry.localizedTitle?.["zh-CN"],
        entry.localizedTitle?.["en-US"],
        entry.localizedDescription?.["zh-CN"],
        entry.localizedDescription?.["en-US"],
        entry.source,
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    })
    .sort((left, right) => compareActivationCandidates(left, right, normalizedQuery, locale));
}

function compareActivationCandidates(
  left: AgentActivationCatalogEntry,
  right: AgentActivationCatalogEntry,
  query: string,
  locale: FrontendLocale,
): number {
  const kindOrder = activationKindOrder.indexOf(left.kind) - activationKindOrder.indexOf(right.kind);
  if (kindOrder !== 0) return kindOrder;
  if (left.selectable !== right.selectable) return left.selectable ? -1 : 1;
  if (left.enabled !== right.enabled) return left.enabled ? -1 : 1;
  const leftScore = activationMatchScore(left, query);
  const rightScore = activationMatchScore(right, query);
  if (leftScore !== rightScore) return rightScore - leftScore;
  const leftTitle = resolveActivationText(left, locale).title;
  const rightTitle = resolveActivationText(right, locale).title;
  return leftTitle.localeCompare(rightTitle) || left.id.localeCompare(right.id) || left.kind.localeCompare(right.kind);
}

export function stepActivationIndex(
  candidates: readonly AgentActivationCatalogEntry[],
  current: number,
  direction: 1 | -1,
): number {
  if (candidates.length === 0) return current;
  for (let offset = 1; offset <= candidates.length; offset += 1) {
    const index = (current + direction * offset + candidates.length * 2) % candidates.length;
    if (candidates[index]?.selectable) return index;
  }
  return current;
}

function activationMatchScore(entry: AgentActivationCatalogEntry, query: string): number {
  if (!query) return 0;
  const values = [entry.id, entry.title, entry.localizedTitle?.["zh-CN"], entry.localizedTitle?.["en-US"]]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLocaleLowerCase());
  if (values.some((value) => value === query)) return 3;
  if (values.some((value) => value.startsWith(query))) return 2;
  return 1;
}

export function readActivationQuery(nextValue: string, caret: number): string | null {
  return readActivationRange(nextValue, caret)?.query ?? null;
}

export function readActivationRange(
  nextValue: string,
  caret: number,
): { query: string; start: number; end: number } | null {
  const beforeCaret = nextValue.slice(0, caret);
  const match = beforeCaret.match(/(?:^|\s)@([^\s@]*)$/u);
  if (!match) return null;
  const suffix = nextValue.slice(caret).match(/^[^\s@]*/u)![0];
  return { query: match[1], start: caret - match[1].length - 1, end: caret + suffix.length };
}

export function readActivationTokens(value: string): string[] {
  return [...value.matchAll(/(?:^|\s)@([^\s@]+)/gu)].map((match) => match[1]);
}

export const ActivationTextOverlay = forwardRef<
  HTMLDivElement,
  { value: string; selected: readonly ExplicitActivationReference[] }
>(function ActivationTextOverlay({ value, selected }, ref) {
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-1 py-2 font-sans text-[14px] leading-5 tracking-normal text-content-primary"
    >
      {value.split(/((?:^|\s)@[^\s@]+)/gu).map((part, index) => (
        <span
          key={index}
          className={selected.some((entry) => part.trim() === `@${entry.id}`) ? "text-accent-content" : undefined}
        >
          {part}
        </span>
      ))}
    </div>
  );
});

export function ActivationPalette({
  catalog,
  query,
  candidates,
  activeIndex,
  selected,
  locale,
  onSelect,
  id,
}: {
  catalog: AgentActivationCatalogSnapshot | null | undefined;
  query: string;
  candidates: readonly AgentActivationCatalogEntry[];
  activeIndex: number;
  selected: readonly ExplicitActivationReference[];
  locale: FrontendLocale;
  onSelect: (index: number) => void;
  id: string;
}): JSX.Element {
  const activeEntry = candidates[activeIndex];
  const scrollRef = useActiveOptionScroll(activeEntry ? `${activeEntry.kind}:${activeEntry.id}:${query}` : undefined);
  const selectableCount = catalog?.entries.filter((entry) => entry.selectable).length ?? 0;
  const statusMessage = !catalog
    ? frontendChatMessage("chat.composer.activation.syncing", {}, locale)
    : candidates.length === 0
      ? selectableCount === 0
        ? frontendChatMessage("chat.composer.activation.empty", {}, locale)
        : frontendChatMessage("chat.composer.activation.noMatch", {}, locale)
      : undefined;

  return (
    <div
      className="absolute bottom-full left-0 z-20 mb-2 flex w-[38rem] max-w-full min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface-panel shadow-panel"
      data-activation-palette
    >
      <Tooltip content={frontendChatMessage("chat.composer.activation.purpose", {}, locale)}>
        <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-content-muted">
          <span aria-hidden="true" className="text-content-muted">
            @
          </span>
          <span>{frontendChatMessage("chat.composer.activation.ariaLabel", {}, locale)}</span>
          {query ? <span className="ml-auto truncate text-content-muted">{query}</span> : null}
        </div>
      </Tooltip>

      <div id={id} role="listbox" aria-label={frontendChatMessage("chat.composer.activation.ariaLabel", {}, locale)}>
        {statusMessage ? (
          <div className="px-3.5 py-5 text-center text-[12px] text-content-muted" role="status" aria-live="polite">
            {statusMessage}
          </div>
        ) : (
          <ScrollArea ref={scrollRef} viewportClassName="max-h-[min(24rem,45dvh)]" className="min-h-0">
            <div className="min-w-0 px-1 pb-1">
              {groupActivationCandidates(candidates).map((group, groupIndex) => {
                const presentation = activationKindPresentation[group.kind];
                return (
                  <div key={group.kind} role="group" aria-label={frontendChatMessage(presentation.label, {}, locale)}>
                    <div
                      className={cn(
                        "px-2 pb-1 text-[11px] font-medium text-content-muted",
                        groupIndex === 0 ? "pt-1" : "mt-1 border-t border-line-subtle pt-2",
                      )}
                    >
                      <span>{frontendChatMessage(presentation.label, {}, locale)}</span>
                    </div>
                    {group.entries.map(({ entry, index }) => {
                      const text = resolveActivationText(entry, locale);
                      const icon = resolveActivationIcon(entry.icon, presentation.icon);
                      const isSelected = selected.some(
                        (selection) =>
                          selection.kind === entry.kind &&
                          selection.id === entry.id &&
                          selection.revision === entry.revision,
                      );
                      return (
                        <Tooltip
                          content={[text.title, text.description, `@${entry.id}`].filter(Boolean).join("\n")}
                          key={`${entry.kind}:${entry.id}`}
                        >
                          <button
                            id={activationOptionId(id, entry)}
                            type="button"
                            role="option"
                            tabIndex={-1}
                            disabled={!entry.selectable}
                            aria-selected={index === activeIndex}
                            data-active-option={index === activeIndex}
                            aria-disabled={!entry.selectable}
                            aria-label={`${text.title} @${entry.id}`}

                            className={cn(
                              "group flex min-h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-accent-focus sm:min-h-8",
                              !entry.selectable
                                ? "cursor-not-allowed opacity-55"
                                : index === activeIndex
                                  ? "bg-surface-hover"
                                  : "hover:bg-surface-hover",
                            )}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => onSelect(index)}
                          >
                            <span className="grid h-5 w-5 shrink-0 place-items-center text-content-secondary">
                              {isAgentToolPresentationIcon(icon) ? (
                                <AgentToolPresentationIcon icon={icon} size={16} aria-hidden="true" />
                              ) : (
                                <AppIcon icon={icon} size={16} aria-hidden="true" />
                              )}
                            </span>
                            <span className="flex min-w-0 flex-1 items-baseline gap-2">
                              <span className="max-w-[50%] shrink-0 truncate text-[13px] text-content-primary">
                                {text.title}
                              </span>
                              {!entry.selectable ? (
                                <span className="shrink-0 text-[11px] text-content-muted">
                                  {entry.enabled
                                    ? frontendChatMessage("chat.composer.activation.needsSetup", {}, locale)
                                    : frontendChatMessage("chat.composer.activation.unavailable", {}, locale)}
                                </span>
                              ) : null}
                              {text.description ? (
                                <span className="min-w-0 flex-1 truncate text-xs text-content-muted">
                                  {text.description}
                                </span>
                              ) : null}
                            </span>
                            {isSelected ? (
                              <AppIcon icon="checkmark" size={14} className="shrink-0 text-content-secondary" />
                            ) : null}
                          </button>
                        </Tooltip>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </div>
      <div className="border-t border-line-subtle px-3.5 py-2 text-[10px] text-content-muted">
        {frontendChatMessage("chat.composer.activation.hint", {}, locale)}
      </div>
    </div>
  );
}

function resolveActivationText(
  entry: AgentActivationCatalogEntry,
  locale: FrontendLocale,
): { readonly title: string; readonly description: string } {
  return {
    title: entry.localizedTitle ? resolveFrontendLocalizedText(entry.localizedTitle, locale) : entry.title,
    description: entry.localizedDescription
      ? resolveFrontendLocalizedText(entry.localizedDescription, locale)
      : entry.description,
  };
}

interface ActivationCandidateGroup {
  readonly kind: AgentActivationKind;
  readonly entries: readonly { readonly entry: AgentActivationCatalogEntry; readonly index: number }[];
}

function groupActivationCandidates(candidates: readonly AgentActivationCatalogEntry[]): ActivationCandidateGroup[] {
  const entriesByKind = new Map<AgentActivationKind, { entry: AgentActivationCatalogEntry; index: number }[]>();
  candidates.forEach((entry, index) => {
    const entries = entriesByKind.get(entry.kind) ?? [];
    entries.push({ entry, index });
    entriesByKind.set(entry.kind, entries);
  });
  return activationKindOrder.flatMap((kind) => {
    const entries = entriesByKind.get(kind);
    return entries?.length ? [{ kind, entries }] : [];
  });
}

export function activationOptionId(listId: string, entry: AgentActivationCatalogEntry): string {
  return `${listId}-${entry.kind}-${entry.id}`;
}

function resolveActivationIcon(
  value: string | undefined,
  kindIcon: AppIconName,
): AppIconName | AgentToolPresentationIconName {
  if (isAgentToolPresentationIcon(value)) return value;
  if (isAppIconName(value)) return value;
  return kindIcon;
}
