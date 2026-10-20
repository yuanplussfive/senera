import { forwardRef } from "react";
import type {
  AgentActivationCatalogEntry,
  AgentActivationCatalogSnapshot,
  AgentActivationKind,
  ExplicitActivationReference,
} from "../../api/eventTypes";
import { frontendChatMessage } from "../../i18n/frontendChatMessageCatalog";
import { resolveFrontendLocalizedText, type FrontendLocale } from "../../i18n/frontendLocaleModel";
import { cn } from "../../lib/util";
import { MotionList, MotionListItem } from "../../shared/motion";
import { AppIcon, isAppIconName, type AppIconName } from "../../shared/ui";
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
  const beforeCaret = nextValue.slice(0, caret);
  const match = beforeCaret.match(/(?:^|\s)@([^\s@]*)$/u);
  return match ? match[1] : null;
}

export function readActivationTokens(value: string): string[] {
  return [...value.matchAll(/(?:^|\s)@([^\s@]+)/gu)].map((match) => match[1]);
}

export const ActivationTextOverlay = forwardRef<HTMLDivElement, { value: string }>(function ActivationTextOverlay(
  { value },
  ref,
) {
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-1 py-1.5 font-sans text-[14px] leading-5 tracking-normal text-content-primary"
    >
      {value.split(/(@[^\s@]+)/gu).map((part, index) =>
        part.startsWith("@") ? (
          <span key={`${part}-${index}`} className="font-medium text-accent-content">
            {part}
          </span>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        ),
      )}
    </div>
  );
});

function compactActivationText(value: string, locale?: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!normalized || !locale) return normalized;
  const segments = normalized.split(/(?<=[.!?。！？])\s*/u).filter(Boolean);
  if (segments.length < 2) return normalized;
  const hasCjk = /[\u3400-\u9fff]/u.test(normalized);
  const hasLatin = /[A-Za-z]/u.test(normalized);
  if (!hasCjk || !hasLatin) return normalized;
  const preferCjk = locale.toLocaleLowerCase().startsWith("zh");
  const preferred = segments.filter((segment) =>
    preferCjk ? /[\u3400-\u9fff]/u.test(segment) : /[A-Za-z]/u.test(segment) && !/[\u3400-\u9fff]/u.test(segment),
  );
  return preferred.length > 0 ? preferred.join(" ") : normalized;
}

export function ActivationPalette({
  catalog,
  query,
  candidates,
  activeIndex,
  selected,
  locale,
  onSelect,
}: {
  catalog: AgentActivationCatalogSnapshot | null | undefined;
  query: string;
  candidates: readonly AgentActivationCatalogEntry[];
  activeIndex: number;
  selected: readonly ExplicitActivationReference[];
  locale: FrontendLocale;
  onSelect: (index: number) => void;
}): JSX.Element {
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
      className="absolute bottom-full left-3 z-20 mb-2 flex w-80 max-w-[90vw] flex-col overflow-hidden rounded-[13px] border border-line-subtle bg-surface-panel/95 shadow-[0_18px_42px_-24px_rgb(43_40_32_/_0.42)] backdrop-blur-md"
      role="listbox"
      aria-label={frontendChatMessage("chat.composer.activation.ariaLabel", {}, locale)}
      aria-activedescendant={candidates[activeIndex] ? activationOptionId(candidates[activeIndex]) : undefined}
    >
      <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[8px] bg-accent-surface font-mono text-[13px] text-accent-content">
            @
          </span>
          <span className="min-w-0 truncate text-[12px] font-medium text-accent-content">@{query}</span>
        </div>
        {catalog ? (
          <span className="shrink-0 text-[10px] tabular-nums text-content-muted">{selectableCount}</span>
        ) : null}
      </div>

      {statusMessage ? (
        <div className="px-3.5 py-5 text-center text-[12px] text-content-muted" role="status" aria-live="polite">
          {statusMessage}
        </div>
      ) : (
        <MotionList className="max-h-72 overflow-y-auto p-1.5" presence="animated">
          {groupActivationCandidates(candidates).map((group, groupIndex) => {
            const presentation = activationKindPresentation[group.kind];
            return (
              <div key={group.kind} role="group" aria-label={frontendChatMessage(presentation.label, {}, locale)}>
                <div
                  className={cn(
                    "flex items-center gap-2 px-2.5 pb-1 text-[10px] font-medium text-content-muted",
                    groupIndex === 0 ? "pt-1" : "border-t border-line-subtle pt-2.5",
                  )}
                >
                  <AppIcon icon={presentation.icon} size={12} aria-hidden="true" />
                  <span>{frontendChatMessage(presentation.label, {}, locale)}</span>
                  <span className="h-px min-w-3 flex-1 bg-line-subtle" aria-hidden="true" />
                  <span className="tabular-nums text-content-disabled">{group.entries.length}</span>
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
                    <MotionListItem key={`${entry.kind}:${entry.id}`} layout="position" initial={false}>
                      <button
                        id={activationOptionId(entry)}
                        type="button"
                        role="option"
                        disabled={!entry.selectable}
                        aria-selected={index === activeIndex}
                        aria-disabled={!entry.selectable}
                        aria-label={`${text.title} @${entry.id}`}
                        className={cn(
                          "group flex w-full items-start gap-2.5 rounded-[11px] px-2.5 py-2 text-left outline-none transition-[background-color,color] duration-150",
                          !entry.selectable
                            ? "cursor-not-allowed opacity-55"
                            : index === activeIndex
                              ? "bg-surface-hover/70"
                              : "hover:bg-surface-hover/45",
                        )}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => onSelect(index)}
                      >
                        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-[7px] bg-surface-muted text-content-secondary transition-colors group-hover:text-content-primary">
                          {isAgentToolPresentationIcon(icon) ? (
                            <AgentToolPresentationIcon icon={icon} size={14} aria-hidden="true" />
                          ) : (
                            <AppIcon icon={icon} size={14} aria-hidden="true" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="min-w-0 truncate text-[12.5px] font-medium text-content-primary">
                              {text.title}
                            </span>
                            <span className="shrink-0 text-[10px] text-content-muted">
                              {entry.selectable
                                ? frontendChatMessage(presentation.label, {}, locale)
                                : entry.enabled
                                  ? frontendChatMessage("chat.composer.activation.needsSetup", {}, locale)
                                  : frontendChatMessage("chat.composer.activation.unavailable", {}, locale)}
                            </span>
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] font-medium text-accent-content">
                            @{entry.id}
                          </span>
                          {text.description ? (
                            <span className="mt-0.5 block truncate text-[10.5px] leading-4 text-content-secondary">
                              {compactActivationText(text.description, locale)}
                            </span>
                          ) : null}
                        </span>
                        {isSelected ? (
                          <AppIcon icon="checkmark" size={14} className="mt-1 text-accent-content" />
                        ) : null}
                      </button>
                    </MotionListItem>
                  );
                })}
              </div>
            );
          })}
        </MotionList>
      )}
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

function activationOptionId(entry: AgentActivationCatalogEntry): string {
  return `activation-option-${entry.kind}-${entry.id}`;
}

function resolveActivationIcon(
  value: string | undefined,
  kindIcon: AppIconName,
): AppIconName | AgentToolPresentationIconName {
  if (isAgentToolPresentationIcon(value)) return value;
  if (isAppIconName(value)) return value;
  return kindIcon;
}
